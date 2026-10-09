/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * Subscribe rate-limit IP trust (plan 022 review): `x-vc-client-ip` is honored
 * only on requests addressed to the service-binding hostname
 * (`vibecms-api.internal`) — a URL no internet client can reach. Direct
 * requests ignore the header (and the old `cf-worker` name check is gone:
 * any zone can name a worker `vibecms-public-*`).
 */
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { handleSubscribe, PROXIED_SITE_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS } from './subscribe'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const T = 1_700_000_000

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const ts = T
  await env.DB
    .prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('ws-sub-ip', 'Sub IP', 'ws-sub-ip', ts, ts)
    .run()
  await env.DB
    .prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('site-sub-ip', 'ws-sub-ip', 'Sub IP Blog', 'sub-ip', ts, ts)
    .run()
  // Dedicated sites for the site-wide-cap tests: the site bucket is shared
  // per site+window, so they must not consume site-sub-ip's budget.
  await env.DB
    .prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('site-sub-flood', 'ws-sub-ip', 'Sub Flood Blog', 'sub-flood', ts, ts)
    .run()
  await env.DB
    .prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('site-sub-direct', 'ws-sub-ip', 'Sub Direct Blog', 'sub-direct', ts, ts)
    .run()
})

function subscribeRequest(
  url: string,
  email: string,
  headers: Record<string, string>,
  siteSlug = 'sub-ip',
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email, siteSlug }),
  })
}

async function storedIpHash(email: string, siteId = 'site-sub-ip'): Promise<string | null> {
  const row = await env.DB
    .prepare('SELECT ip_hash FROM subscribers WHERE site_id = ? AND email = ?')
    .bind(siteId, email)
    .first<{ ip_hash: string | null }>()
  return row?.ip_hash ?? null
}

describe('handleSubscribe x-vc-client-ip trust', () => {
  it('uses the forwarded IP only on the service-binding hostname', async () => {
    const forwarded = { 'x-vc-client-ip': '203.0.113.7', 'cf-connecting-ip': '198.51.100.2' }
    const internal = await handleSubscribe(
      subscribeRequest('https://vibecms-api.internal/api/subscribe', 'via-binding@example.com', forwarded),
    )
    expect(internal.status).toBe(200)

    // Same headers on the public app hostname: the injected header is ignored
    // and CF-Connecting-IP wins, so the stored hash must differ.
    const direct = await handleSubscribe(
      subscribeRequest('https://app.basedui.dev/api/subscribe', 'direct@example.com', forwarded),
    )
    expect(direct.status).toBe(200)

    const bindingHash = await storedIpHash('via-binding@example.com')
    const directHash = await storedIpHash('direct@example.com')
    expect(bindingHash).toBeTruthy()
    expect(directHash).toBeTruthy()
    expect(directHash).not.toBe(bindingHash)
  })

  it('hashes the same CF-Connecting-IP identically on both hostnames (proves the direct hash is the edge IP)', async () => {
    const headers = { 'cf-connecting-ip': '198.51.100.9' }
    await handleSubscribe(subscribeRequest('https://vibecms-api.internal/api/subscribe', 'b1@example.com', headers))
    await handleSubscribe(subscribeRequest('https://app.basedui.dev/api/subscribe', 'b2@example.com', headers))
    expect(await storedIpHash('b2@example.com')).toBe(await storedIpHash('b1@example.com'))
  })

  it('ignores x-vc-client-ip even with a forged cf-worker header', async () => {
    const forged = {
      'x-vc-client-ip': '203.0.113.99',
      'cf-connecting-ip': '198.51.100.2',
      // Old trust signal: an attacker zone could name its worker vibecms-public-*.
      'cf-worker': 'vibecms-public-evil',
    }
    await handleSubscribe(subscribeRequest('https://app.basedui.dev/api/subscribe', 'forged@example.com', forged))
    const forgedHash = await storedIpHash('forged@example.com')

    // The binding path with the same forwarded IP hashes differently — proof
    // the direct request fell back to CF-Connecting-IP, not the forged value.
    await handleSubscribe(
      subscribeRequest('https://vibecms-api.internal/api/subscribe', 'forged-ref@example.com', {
        'x-vc-client-ip': '203.0.113.99',
      }),
    )
    const bindingHash = await storedIpHash('forged-ref@example.com')
    expect(forgedHash).toBeTruthy()
    expect(forgedHash).not.toBe(bindingHash)
  })
})

describe('handleSubscribe proxied site rate limit', () => {
  const BINDING_URL = 'https://vibecms-api.internal/api/subscribe'
  const DIRECT_URL = 'https://app.basedui.dev/api/subscribe'

  it('bounds a flood rotating spoofed x-vc-client-ip at the proxied site cap', async () => {
    // Fill the proxied site bucket to one below the cap, then rotate spoofed
    // IPs: every per-IP bucket is fresh, so only the site bucket can stop it.
    const now = Math.floor(Date.now() / 1000)
    const bucket = Math.floor(now / RATE_LIMIT_WINDOW_SECONDS)
    await env.DB
      .prepare('INSERT INTO rate_limits (id, count, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(`subscribe-proxied:site-sub-flood:${bucket}`, PROXIED_SITE_RATE_LIMIT_MAX - 1, (bucket + 1) * RATE_LIMIT_WINDOW_SECONDS, now, now)
      .run()
    const last = await handleSubscribe(
      subscribeRequest(BINDING_URL, 'flood-last@example.com', { 'x-vc-client-ip': '203.0.113.1' }, 'sub-flood'),
    )
    expect(last.status).toBe(200)
    const over = await handleSubscribe(
      subscribeRequest(BINDING_URL, 'flood-over@example.com', { 'x-vc-client-ip': '203.0.113.250' }, 'sub-flood'),
    )
    expect(over.status).toBe(429)
    // Denied request must not have written a subscriber row.
    const row = await env.DB
      .prepare('SELECT id FROM subscribers WHERE site_id = ? AND email = ?')
      .bind('site-sub-flood', 'flood-over@example.com')
      .first()
    expect(row).toBeNull()
    // Direct traffic keys on CF-Connecting-IP and is not subject to the proxied cap.
    const direct = await handleSubscribe(
      subscribeRequest(DIRECT_URL, 'flood-direct@example.com', { 'cf-connecting-ip': '198.51.100.9' }, 'sub-flood'),
    )
    expect(direct.status).toBe(200)
  })

  it('still enforces the per-IP limit on direct requests', async () => {
    const headers = { 'cf-connecting-ip': '198.51.100.77' }
    for (let i = 0; i < 5; i++) {
      const res = await handleSubscribe(
        subscribeRequest(DIRECT_URL, `per-ip-${i}@example.com`, headers, 'sub-direct'),
      )
      expect(res.status).toBe(200)
    }
    const over = await handleSubscribe(
      subscribeRequest(DIRECT_URL, 'per-ip-over@example.com', headers, 'sub-direct'),
    )
    expect(over.status).toBe(429)
  })

  it('leaves a normal single visitor unaffected', async () => {
    const res = await handleSubscribe(
      subscribeRequest(
        BINDING_URL,
        'normal@example.com',
        { 'x-vc-client-ip': '192.0.2.5' },
        'sub-direct',
      ),
    )
    expect(res.status).toBe(200)
    expect(await storedIpHash('normal@example.com', 'site-sub-direct')).toBeTruthy()
  })
})
