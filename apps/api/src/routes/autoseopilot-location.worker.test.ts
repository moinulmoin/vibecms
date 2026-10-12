/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * Plan 022 phase 3a: the managed location endpoints
 * (PUT/POST /internal/autoseopilot/sites/:externalWorkspaceId/location[/check]).
 * Same secret/correlation conventions as the other managed routes.
 */
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { proxyFingerprint } from '@vc/core'
import { app } from '@/index'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}
const INTERNAL_SECRET = 'managed-location-test-secret'
const EXTERNAL_WORKSPACE_ID = '00000000-0000-4000-8000-00000000a901'
const CREDENTIAL_ID = '00000000-0000-4000-8000-00000000a902'
const RIVAL_WORKSPACE_ID = '00000000-0000-4000-8000-00000000a903'
const RIVAL_CREDENTIAL_ID = '00000000-0000-4000-8000-00000000a904'
const TOKEN = ['vc', 'test', 'f'.repeat(32)].join('_') + '_'
const RIVAL_TOKEN = ['vc', 'test', 'e'.repeat(32)].join('_') + '_'
const configuredEnv = {
  ...env,
  AUTOSEOPILOT_INTERNAL_SECRET: INTERNAL_SECRET,
} as typeof env

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('X-AUTOSEOPILOT-INTERNAL-SECRET', INTERNAL_SECRET)
  return app.fetch(new Request(`https://app.basedui.dev${path}`, { ...init, headers }), configuredEnv)
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const provision = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ownerEmail: 'managed-location-owner@example.test',
      siteName: 'Managed Location Site',
      credential: { rawToken: TOKEN, credentialId: CREDENTIAL_ID, generation: 1 },
      entitlement: { status: 'active', expiresAt: null },
    }),
  })
  expect([200, 201]).toContain(provision.status)
  const rival = await request(`/internal/autoseopilot/sites/${RIVAL_WORKSPACE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ownerEmail: 'managed-location-rival@example.test',
      siteName: 'Managed Location Rival',
      credential: { rawToken: RIVAL_TOKEN, credentialId: RIVAL_CREDENTIAL_ID, generation: 1 },
      entitlement: { status: 'active', expiresAt: null },
    }),
  })
  expect([200, 201]).toContain(rival.status)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function healthResponse(siteId: string, proxyId: string) {
  return proxyFingerprint(proxyId).then(
    (fingerprint) => new Response(JSON.stringify({ ok: true, siteId, proxyFingerprint: fingerprint }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('managed location routes', () => {
  it('rejects invalid bodies and ids with managed error codes', async () => {
    const badId = await request('/internal/autoseopilot/sites/not-a-uuid/location', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'default' }),
    })
    expect(badId.status).toBe(400)
    expect((await json(badId)).error.code).toBe('VALIDATION_ERROR')

    const badBody = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'subdomain', url: 'blog.example.com' }),
    })
    expect(badBody.status).toBe(400)

    const badUrl = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'subpath', url: 'app.basedui.dev/blog' }),
    })
    expect(badUrl.status).toBe(400)
  })

  it('sets a subpath location and returns proxy target + snippets', async () => {
    const response = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'subpath', url: 'https://customer.example.com/blog' }),
    })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.location).toMatchObject({
      type: 'subpath',
      url: 'https://customer.example.com/blog',
      status: 'pending',
    })
    expect(body.location.proxyTarget).toContain('/_vc/p/')
    expect(body.location.snippets.cloudflareWorker.route).toBe('customer.example.com/blog*')
    expect(body.location.snippets.vercel).toContain('rewrites')
  })

  it('check needs an effective entitlement, like the dashboard and MCP checks', async () => {
    const row = await env.DB
      .prepare("SELECT site_id, proxy_id FROM domains WHERE type = 'subpath'")
      .first<{ site_id: string; proxy_id: string }>()
    expect(row).toBeTruthy()
    const probe = vi.fn(async () => healthResponse(row!.site_id, row!.proxy_id))
    vi.stubGlobal('fetch', probe)

    // Sponsorship lapsed after the claim was saved; the proxy still answers.
    await env.DB
      .prepare('UPDATE autoseopilot_managed_sites SET entitlement_expires_at = 1 WHERE external_workspace_id = ?')
      .bind(EXTERNAL_WORKSPACE_ID)
      .run()
    try {
      const response = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location/check`, { method: 'POST' })
      expect(response.status).toBe(409)
      expect((await json(response)).error.code).toBe('BILLING_REQUIRED')
      expect(probe).not.toHaveBeenCalled()
      const stored = await env.DB
        .prepare("SELECT status FROM domains WHERE type = 'subpath' AND site_id = ?")
        .bind(row!.site_id)
        .first<{ status: string }>()
      expect(stored?.status).toBe('pending')
    } finally {
      await env.DB
        .prepare('UPDATE autoseopilot_managed_sites SET entitlement_expires_at = NULL WHERE external_workspace_id = ?')
        .bind(EXTERNAL_WORKSPACE_ID)
        .run()
    }
  })

  it('check activates the location once the proxy answers health', async () => {
    const row = await env.DB
      .prepare("SELECT site_id, proxy_id FROM domains WHERE type = 'subpath'")
      .first<{ site_id: string; proxy_id: string }>()
    expect(row).toBeTruthy()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/_vc/health')) return healthResponse(row!.site_id, row!.proxy_id)
      if (url.endsWith('/robots.txt')) {
        return new Response('Sitemap: https://customer.example.com/blog/sitemap.xml', { status: 200 })
      }
      return new Response('<html></html>', { status: 200 })
    }))

    const response = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location/check`, { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.check.ok).toBe(true)
    expect(body.location.status).toBe('active')

    // The activation is in the customer's activity history, as it is for
    // dashboard/MCP checks.
    const verified = await env.DB
      .prepare("SELECT actor_type, actor_name FROM activity_events WHERE site_id = ? AND action = 'site.location.verified'")
      .bind(row!.site_id)
      .all<{ actor_type: string; actor_name: string }>()
    expect(verified.results).toEqual([{ actor_type: 'human', actor_name: 'AutoSEOPilot' }])

    // Re-checking an already active location records nothing new.
    const again = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location/check`, { method: 'POST' })
    expect(again.status).toBe(200)
    const count = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM activity_events WHERE site_id = ? AND action = 'site.location.verified'")
      .bind(row!.site_id)
      .first<{ count: number }>()
    expect(count?.count).toBe(1)
  })

  it('type default removes the subpath location', async () => {
    const response = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'default' }),
    })
    expect(response.status).toBe(200)
    expect((await json(response)).location.type).toBe('default')
    const rows = await env.DB.prepare("SELECT COUNT(*) AS count FROM domains WHERE type = 'subpath'").first<{ count: number }>()
    expect(rows?.count).toBe(0)
  })

  it('an activation race on the hostname answers 409 CONFLICT, not 500', async () => {
    // Both sites hold a pending claim on the same hostname (allowed since
    // 0036). The rival activates in the gap between our demotable-row SELECT
    // and our atomic batch: the activation hits idx_domains_subpath_active,
    // recordSubpathCheck throws ConflictError, and the route must translate it
    // to the managed 409 the caller can retry from.
    const put = await request(`/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'subpath', url: 'https://raced-host.example.com/blog' }),
    })
    expect(put.status).toBe(200)
    const rivalPut = await request(`/internal/autoseopilot/sites/${RIVAL_WORKSPACE_ID}/location`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'subpath', url: 'https://raced-host.example.com/blog' }),
    })
    expect(rivalPut.status).toBe(200)

    const ours = await env.DB
      .prepare(
        `SELECT d.site_id, d.proxy_id FROM domains d
         JOIN autoseopilot_managed_sites m ON m.site_id = d.site_id
         WHERE d.type = 'subpath' AND m.external_workspace_id = ?`,
      )
      .bind(EXTERNAL_WORKSPACE_ID)
      .first<{ site_id: string; proxy_id: string }>()
    expect(ours).toBeTruthy()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/_vc/health')) return healthResponse(ours!.site_id, ours!.proxy_id)
      if (url.endsWith('/robots.txt')) {
        return new Response('Sitemap: https://raced-host.example.com/blog/sitemap.xml', { status: 200 })
      }
      return new Response('<html></html>', { status: 200 })
    }))

    let raced = false
    const raceEnv = {
      ...configuredEnv,
      DB: new Proxy(env.DB, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (prop !== 'batch' || typeof value !== 'function') {
            return typeof value === 'function' ? value.bind(target) : value
          }
          return async (stmts: D1PreparedStatement[]) => {
            if (!raced) {
              raced = true
              // The rival's claim went live a millisecond before our batch.
              await env.DB
                .prepare(
                  `UPDATE domains SET status = 'active' WHERE type = 'subpath' AND hostname = 'raced-host.example.com'
                   AND site_id != ?`,
                )
                .bind(ours!.site_id)
                .run()
            }
            return value.call(target, stmts)
          }
        },
      }),
    } as typeof env

    const response = await app.fetch(
      new Request(`https://app.basedui.dev/internal/autoseopilot/sites/${EXTERNAL_WORKSPACE_ID}/location/check`, {
        method: 'POST',
        headers: { 'X-AUTOSEOPILOT-INTERNAL-SECRET': INTERNAL_SECRET },
      }),
      raceEnv,
    )
    expect(raced).toBe(true)
    expect(response.status).toBe(409)
    const body = await json(response)
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toContain('Run the check again')

    // Our claim stayed pending; the rival's activation owned the hostname.
    const stored = await env.DB
      .prepare(`SELECT status FROM domains WHERE type = 'subpath' AND hostname = 'raced-host.example.com' AND site_id = ?`)
      .bind(ours!.site_id)
      .first<{ status: string }>()
    expect(stored?.status).toBe('pending')
  })
})
