import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { app } from '../index'

// Directory reviewers (OpenAI, Anthropic) must sign in without receiving an
// email. One configured reviewer address accepts one configured code.
const mutableEnv = env as unknown as Record<string, unknown>
const saved = { REVIEWER_EMAIL: mutableEnv.REVIEWER_EMAIL, REVIEWER_OTP: mutableEnv.REVIEWER_OTP }
const REVIEWER = 'review@vibecms.dev'
const CODE = '482915'

afterEach(() => {
  mutableEnv.REVIEWER_EMAIL = saved.REVIEWER_EMAIL
  mutableEnv.REVIEWER_OTP = saved.REVIEWER_OTP
})

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

function post(path: string, body: unknown) {
  const origin = String(env.BETTER_AUTH_URL)
  return app.fetch(new Request(`${origin}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  }), env)
}

async function signIn(email: string, otp: string) {
  expect((await post('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200)
  return post('/sign-in/email-otp', { email, otp })
}

describe('directory reviewer sign-in', () => {
  it('signs the reviewer in with the configured code and no emailed code', async () => {
    mutableEnv.REVIEWER_EMAIL = REVIEWER
    mutableEnv.REVIEWER_OTP = CODE
    const response = await signIn('Review@VibeCMS.dev', CODE)
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('session_token')
  })

  it('rejects the reviewer code for every other email', async () => {
    mutableEnv.REVIEWER_EMAIL = REVIEWER
    mutableEnv.REVIEWER_OTP = CODE
    const response = await signIn('someone-else@example.com', CODE)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.headers.get('set-cookie') ?? '').not.toContain('session_token')
  })

  it('rejects a wrong code for the reviewer email', async () => {
    mutableEnv.REVIEWER_EMAIL = REVIEWER
    mutableEnv.REVIEWER_OTP = CODE
    const response = await signIn(REVIEWER, '000000')
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.headers.get('set-cookie') ?? '').not.toContain('session_token')
  })

  // Fresh addresses: a code already sent stays valid until it expires.
  it('accepts no fixed code when reviewer sign-in is not configured', async () => {
    delete mutableEnv.REVIEWER_EMAIL
    delete mutableEnv.REVIEWER_OTP
    const response = await signIn('review-off@vibecms.dev', CODE)
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('ignores a configured code that is not six digits', async () => {
    mutableEnv.REVIEWER_EMAIL = 'review-short@vibecms.dev'
    mutableEnv.REVIEWER_OTP = '1234'
    const response = await signIn('review-short@vibecms.dev', '1234')
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})
