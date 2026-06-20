import { env } from 'cloudflare:workers'
import { createD1SubscriberRepository } from '@vc/db'

import { SUBSCRIBE_CONSENT_TEXT, SUBSCRIBE_CONSENT_VERSION } from '~/lib/subscribe-consent'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SECONDS = 3600
const BODY_SIZE_LIMIT = 4096
const EMAIL_MAX_LENGTH = 254
const SITE_SLUG_MAX_LENGTH = 128
const SOURCE_URL_MAX_LENGTH = 2048

// HMAC-SHA256 keyed by TOKEN_PEPPER; returns null if pepper is absent or sign fails.
async function hmacBase64Url(pepper: string, value: string): Promise<string | null> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return null
  }
}

export type SubscribeResult =
  | { status: 200; body: { ok: true } }
  | { status: 400; body: { ok: false; error: 'invalid_email' } }
  | { status: 429; body: { ok: false; error: 'rate_limited' } }

export async function handleSubscribe(request: Request): Promise<SubscribeResult> {
  // Cap body size before parsing - reject oversized payloads pre-parse
  const clHeader = request.headers.get('content-length')
  if (clHeader !== null) {
    const cl = parseInt(clHeader, 10)
    if (Number.isFinite(cl) && cl > BODY_SIZE_LIMIT) {
      return { status: 400, body: { ok: false, error: 'invalid_email' } }
    }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { status: 400, body: { ok: false, error: 'invalid_email' } }
  }

  // Guard non-object body (null, array, primitive) before destructuring
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, body: { ok: false, error: 'invalid_email' } }
  }

  const { email: rawEmail, siteSlug: rawSlug, company } = body as Record<string, unknown>

  // Honeypot - return neutral success without any write
  if (typeof company === 'string' && company.length > 0) {
    return { status: 200, body: { ok: true } }
  }

  // Normalize + validate email; enforce RFC 5321 max length
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!email || email.length > EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, body: { ok: false, error: 'invalid_email' } }
  }

  // Cap siteSlug length; oversized slug cannot match any stored slug
  const siteSlug = typeof rawSlug === 'string' ? rawSlug.trim() : ''
  if (!siteSlug || siteSlug.length > SITE_SLUG_MAX_LENGTH) {
    // Unknown site -> neutral success (no enumeration)
    return { status: 200, body: { ok: true } }
  }

  // Resolve site BEFORE rate-limiting so unknown slugs never touch rate_limits.
  // This prevents slug-variation from minting unlimited rate-limit buckets.
  const siteRow = await env.DB.prepare(
    `SELECT id FROM sites WHERE slug = ? AND status = 'active' LIMIT 1`,
  )
    .bind(siteSlug)
    .first<{ id: string }>()

  if (!siteRow) {
    // Unknown site -> neutral success (no enumeration)
    return { status: 200, body: { ok: true } }
  }

  // HMAC-SHA256 hashes keyed by TOKEN_PEPPER; degrade to null when pepper absent
  const pepper = env.TOKEN_PEPPER ?? ''
  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  const ua = request.headers.get('user-agent') ?? ''
  const ipHash = ip && pepper ? await hmacBase64Url(pepper, ip) : null
  const uaHash = ua && pepper ? await hmacBase64Url(pepper, ua) : null

  // Rate-limit keyed by canonical site id (not caller-supplied slug) + ip hash + window bucket.
  // Fail closed on any error - this is an unauthenticated public endpoint.
  const ts = Math.floor(Date.now() / 1000)
  const bucket = Math.floor(ts / RATE_LIMIT_WINDOW_SECONDS)
  const windowEnd = (bucket + 1) * RATE_LIMIT_WINDOW_SECONDS
  const rateLimitId = `subscribe:${siteRow.id}:${ipHash ?? 'anon'}:${bucket}`

  try {
    const rlResult = await env.DB.prepare(
      `INSERT INTO rate_limits (id, count, expires_at, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET count = rate_limits.count + 1, updated_at = excluded.updated_at
       WHERE rate_limits.count < ?`,
    )
      .bind(rateLimitId, windowEnd, ts, ts, RATE_LIMIT_MAX)
      .run()

    if (Math.random() < 0.02) {
      await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(ts).run()
    }

    if (rlResult.meta.changes === 0) {
      return { status: 429, body: { ok: false, error: 'rate_limited' } }
    }
  } catch (err) {
    // Fail closed - treat rate-limit check failure as rate_limited
    console.error('[subscribe-rate-limit] check failed, treating as rate_limited:', err)
    return { status: 429, body: { ok: false, error: 'rate_limited' } }
  }

  // Cap sourceUrl to prevent oversized strings reaching D1
  const rawSourceUrl =
    request.headers.get('referer') ??
    request.headers.get('referrer') ??
    request.url ??
    null
  const sourceUrl = rawSourceUrl ? rawSourceUrl.slice(0, SOURCE_URL_MAX_LENGTH) : null

  await createD1SubscriberRepository(env.DB).addPending({
    siteId: siteRow.id,
    email,
    sourceUrl,
    consentText: SUBSCRIBE_CONSENT_TEXT,
    consentVersion: SUBSCRIBE_CONSENT_VERSION,
    ipHash,
    uaHash,
  })

  // Idempotent: duplicate email returns same neutral success
  return { status: 200, body: { ok: true } }
}
