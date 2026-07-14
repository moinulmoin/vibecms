import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { app, redactErrorText } from './index'

describe('API Worker request hardening', () => {
  it('rejects an oversized auth body before dispatch', async () => {
    const response = await app.fetch(
      new Request('https://app.basedui.dev/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(64 * 1024 + 1),
      }),
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
