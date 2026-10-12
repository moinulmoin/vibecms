import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { app } from '../index'

// POST /api/dashboard/posts/seo is a cookie-authed browser route: CSRF guard
// runs before session resolution, and it is POST-only (no GET alias).
const seoPost = (headers: HeadersInit = {}) =>
  app.fetch(
    new Request('https://app.basedui.dev/api/dashboard/posts/seo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ postId: 'post_1' }),
    }),
    env,
  )

describe('POST /api/dashboard/posts/seo', () => {
  it('rejects cross-origin browser posts before authentication', async () => {
    const response = await seoPost({ origin: 'https://evil.example' })
    expect(response.status).toBe(403)
  })

  it('rejects posts without an explicit same-origin signal', async () => {
    // No Origin/Referer/Sec-Fetch-Site headers at all -> CSRF guard rejects.
    const response = await seoPost()
    expect(response.status).toBe(403)
  })

  it('requires a session after the CSRF guard passes', async () => {
    const response = await seoPost({ 'sec-fetch-site': 'same-origin' })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    })
  })

  it('accepts a matching Origin header and reaches the auth guard', async () => {
    const response = await seoPost({ origin: 'https://app.basedui.dev' })
    expect(response.status).toBe(401)
  })

  it('is POST-only: GET has no route', async () => {
    const response = await app.fetch(
      new Request('https://app.basedui.dev/api/dashboard/posts/seo?postId=post_1'),
      env,
    )
    expect(response.status).toBe(404)
  })
})
