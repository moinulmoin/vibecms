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
import { handleSubscribe } from './subscribe'

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
})

function subscribeRequest(url: string, email: string, headers: Record<string, string>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email, siteSlug: 'sub-ip' }),
  })
}

async function storedIpHash(email: string): Promise<string | null> {
  const row = await env.DB
    .prepare('SELECT ip_hash FROM subscribers WHERE site_id = ? AND email = ?')
    .bind('site-sub-ip', email)
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
