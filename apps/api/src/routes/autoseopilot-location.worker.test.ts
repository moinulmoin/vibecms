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
const TOKEN = ['vc', 'test', 'f'.repeat(32)].join('_') + '_'

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
})
