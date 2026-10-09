import { env } from 'cloudflare:workers'
import { createDataAccess, createD1SubscriberRepository } from '@vc/db'
import { API_BINDING_HOSTNAME } from '@vc/config'

import { SUBSCRIBE_CONSENT_TEXT, SUBSCRIBE_CONSENT_VERSION } from '@/lib/subscribe-consent'

const RATE_LIMIT_MAX = 5
export const RATE_LIMIT_WINDOW_SECONDS = 3600
// Cap on accepted subscribes that carry a forwarded client IP (proxied subpath
// blogs), per site per window. That IP is the client-controlled first
// X-Forwarded-For hop, so the per-IP key can be gamed there; this is the abuse
// bound for a flood rotating spoofed IPs. Direct traffic keys on
// CF-Connecting-IP, which can't be spoofed, so it is not capped here. 300/hour
// leaves room for a post that goes viral.
export const PROXIED_SITE_RATE_LIMIT_MAX = 300
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
  const siteId = await createDataAccess(env.DB).sites.getSiteIdBySlug(siteSlug)

  if (!siteId) {
    // Unknown site -> neutral success (no enumeration)
    return { status: 200, body: { ok: true } }
  }

  // HMAC-SHA256 hashes keyed by TOKEN_PEPPER; degrade to null when pepper absent
  const pepper = env.TOKEN_PEPPER ?? ''
  // Only the public Worker forwards `x-vc-client-ip` (its first
  // X-Forwarded-For hop, set for proxied subpath blogs), and it always
  // addresses the service binding at `https://<API_BINDING_HOSTNAME>`.
  // Service bindings preserve the caller-supplied URL, and no zone can route
  // internet traffic to that hostname — so hostname equality, not the
  // caller-named `cf-worker` header (a zone name an attacker's own worker
  // could match), is the trust signal. A client-spoofed header on a direct
  // request is ignored.
  // The forwarded value itself is NOT trustworthy: X-Forwarded-For's first
  // hop is client-controlled, so the per-IP bucket below only gives real
  // visitors behind a proxy per-visitor fairness — the site-wide cap is the
  // actual abuse bound.
  const viaBinding = new URL(request.url).hostname === API_BINDING_HOSTNAME
  const proxiedIp = viaBinding ? request.headers.get('x-vc-client-ip') ?? '' : ''
  const ip = proxiedIp || (request.headers.get('CF-Connecting-IP') ?? '')
  const ua = request.headers.get('user-agent') ?? ''
  const ipHash = ip && pepper ? await hmacBase64Url(pepper, ip) : null
  const uaHash = ua && pepper ? await hmacBase64Url(pepper, ua) : null

  // Two fixed-window buckets, both fail closed:
  //  1. per-IP: keyed by site id + hashed client IP — fairness per visitor.
  //     Spoofable via x-vc-client-ip on the binding path, so not a bound.
  //  2. site-wide, proxied requests only: keyed by site id alone — the abuse
  //     bound against floods that rotate spoofed forwarded IPs.
  const ts = Math.floor(Date.now() / 1000)
  const bucket = Math.floor(ts / RATE_LIMIT_WINDOW_SECONDS)
  const windowEnd = (bucket + 1) * RATE_LIMIT_WINDOW_SECONDS
  const rateLimitId = `subscribe:${siteId}:${ipHash ?? 'anon'}:${bucket}`
  const siteRateLimitId = `subscribe-proxied:${siteId}:${bucket}`

  try {
    const rateLimits = createDataAccess(env.DB).rateLimits
    const { allowed } = await rateLimits.increment({
      id: rateLimitId,
      windowExpiresAt: windowEnd,
      max: RATE_LIMIT_MAX,
      now: ts,
    })

    if (Math.random() < 0.02) {
      await rateLimits.deleteExpired(ts)
    }

    if (!allowed) {
      return { status: 429, body: { ok: false, error: 'rate_limited' } }
    }

    // Proxied requests only, and only after the per-IP check passes so a
    // blocked visitor does not spend the shared site budget.
    if (proxiedIp) {
      const siteWide = await rateLimits.increment({
        id: siteRateLimitId,
        windowExpiresAt: windowEnd,
        max: PROXIED_SITE_RATE_LIMIT_MAX,
        now: ts,
      })
      if (!siteWide.allowed) {
        return { status: 429, body: { ok: false, error: 'rate_limited' } }
      }
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
    siteId,
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
