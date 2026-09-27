import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { app, redactErrorText } from './index'

describe('API Worker request hardening', () => {
  it('rejects an oversized auth body before dispatch', async () => {
    const body = 'x'.repeat(64 * 1024 + 1)
    const response = await app.request(
      '/api/auth/sign-in/email-otp',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.length),
        },
        body,
      },
      env,
    )

    expect(response.status).toBe(413)
  })

  it('returns a schema-complete unauthenticated dashboard context', async () => {
    const response = await app.fetch(
      new Request('https://app.basedui.dev/api/dashboard/context'),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      user: null,
      app: null,
      siteSetupComplete: false,
      siteDisplayName: null,
    })
  })

  it('redacts credentials and OTPs from diagnostic text', () => {
    const redacted = redactErrorText(
      'Authorization: Bearer vc_live_secret token=raw-token otp=123456 password=hunter2',
    )

    expect(redacted).not.toContain('vc_live_secret')
    expect(redacted).not.toContain('raw-token')
    expect(redacted).not.toContain('123456')
    expect(redacted).not.toContain('hunter2')
    expect(redacted).toContain('[redacted]')
  })
})

describe('POST /api/subscribe internal route', () => {
  it('runs the subscribe handler (invalid email -> 400, not the 404 a missing route yields)', async () => {
    const response = await app.fetch(
      new Request('https://app.basedui.dev/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', siteSlug: 'any-site' }),
      }),
      env,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_email' })
  })

  it('returns neutral success for a honeypot fill without writing (route is mounted, not 404)', async () => {
    const response = await app.fetch(
      new Request('https://app.basedui.dev/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reader@example.com', siteSlug: 'any-site', company: 'bot-trap' }),
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('marks subscription responses as no-store', async () => {
    const response = await app.fetch(
      new Request('https://app.basedui.dev/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reader@example.com', siteSlug: 'any-site', company: 'bot-trap' }),
      }),
      env,
    )

    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /api/health/ready', () => {
  // The test wrangler config binds DB but not ASSETS_BUCKET, so the probe
  // bindings are stubbed here to exercise the handler's allSettled logic
  // deterministically while still exercising the real route + middleware.
  const okDb = { prepare: () => ({ first: async () => ({ ok: 1 }) }) } as unknown as D1Database
  const okBucket = { list: async () => ({ objects: [] }) } as unknown as R2Bucket
  const brokenBucket = {
    list: async () => {
      throw new Error('R2 unavailable')
    },
  } as unknown as R2Bucket

  it('reports ready with both dependencies probed', async () => {
    const readyEnv = { ...env, DB: okDb, ASSETS_BUCKET: okBucket } as typeof env
    const response = await app.fetch(new Request('https://app.basedui.dev/api/health/ready'), readyEnv)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      status: 'ready',
      checks: { database: 'ready', assets: 'ready' },
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('reports unavailable when a dependency probe rejects (guards against a readiness false-positive)', async () => {
    const brokenEnv = { ...env, DB: okDb, ASSETS_BUCKET: brokenBucket } as typeof env
    const response = await app.fetch(new Request('https://app.basedui.dev/api/health/ready'), brokenEnv)

    expect(response.status).toBe(503)
    const body = (await response.json()) as { ok: boolean; status: string; checks: Record<string, string> }
    expect(body).toMatchObject({ ok: false, status: 'unavailable' })
    expect(body.checks).toMatchObject({ assets: 'unavailable' })
  })
})

describe('app-host agent discovery', () => {
  const get = (path: string) => app.fetch(new Request(`https://app.basedui.dev${path}`), env)

  it('serves the catalog, server card, skills index and exact skill artifacts', async () => {
    const catalog = await get('/.well-known/api-catalog')
    expect(catalog.status).toBe(200)
    expect(catalog.headers.get('content-type')).toContain('application/linkset+json')
    expect((await catalog.json() as { linkset: unknown[] }).linkset).toHaveLength(1)

    const card = await get('/.well-known/mcp/server-card.json')
    expect(card.headers.get('content-type')).toContain('application/json')
    expect(await card.json()).toMatchObject({ serverInfo: { name: 'vibecms', version: '0.1.0' }, endpoint: `${env.APP_URL}/mcp`, capabilities: { tools: {} } })

    const index = await get('/.well-known/agent-skills/index.json')
    const document = await index.json() as { $schema: string; skills: { name: string; url: string; digest: string }[] }
    expect(document.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(document.skills.map((skill) => skill.name)).toEqual(['vibecms-core', 'vibecms-writing'])
    for (const skill of document.skills) {
      const artifact = await get(new URL(skill.url).pathname)
      expect(artifact.status).toBe(200)
      expect(artifact.headers.get('content-type')).toContain('text/markdown')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await artifact.text()))
      expect(skill.digest).toBe(`sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`)
    }
  })

  it('serves app host auth, OpenAPI, llms and robots with their expected types', async () => {
    const auth = await get('/auth.md')
    expect(auth.headers.get('content-type')).toContain('text/markdown')
    expect(await auth.text()).toContain('Authorization: Bearer')
    const openapi = await get('/openapi.json')
    expect(openapi.status).toBe(200)
    expect(openapi.headers.get('content-type')).toContain('application/json')
    expect(await openapi.json()).toMatchObject({ openapi: expect.any(String) })
    const llms = await get('/llms.txt')
    expect(llms.headers.get('content-type')).toContain('text/markdown')
    expect(await llms.text()).toContain(`${env.APP_URL}/mcp`)
    const robots = await get('/robots.txt')
    expect(robots.headers.get('content-type')).toContain('text/plain')
    expect(await robots.text()).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=no')
  })

  it('returns JSON 404 for unknown well-known paths', async () => {
    const response = await get('/.well-known/unknown')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
