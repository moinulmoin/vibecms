import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveUserAppContext: vi.fn(),
  getSiteSetup: vi.fn(),
}))

vi.mock('@/server/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
  githubSignInEnabled: () => false,
  googleSignInEnabled: () => false,
}))
vi.mock('@/server/app-selection', () => ({ readAppSelection: async () => null }))
vi.mock('@/server/onboarding', () => ({
  resolveUserAppContext: mocks.resolveUserAppContext,
  getSiteSetup: mocks.getSiteSetup,
}))

import { requireAppFromRequest } from './session-context'

function request(expected?: string) {
  return new Request(new URL('/api/dashboard/posts/create', env.APP_URL), {
    method: 'POST',
    headers: expected === undefined ? {} : { 'x-vc-expected-site': expected },
  })
}

describe('authenticated dashboard request guard', () => {
  it('allows matching and legacy requests, and rejects a stale tab before a write', async () => {
    const user = { id: 'user-a', name: 'Owner', email: 'owner@example.test' }
    mocks.getSession.mockResolvedValue({ user })
    mocks.resolveUserAppContext.mockResolvedValue({
      app: { user, siteId: 'site-b', workspaceId: 'workspace-a', actor: { type: 'human', id: user.id, name: user.name, role: 'owner' } },
      apps: [],
    })
    mocks.getSiteSetup.mockResolvedValue({ isComplete: true, name: 'Site B' })

    expect(await requireAppFromRequest(request('site-b'))).toHaveProperty('app.siteId', 'site-b')
    expect(await requireAppFromRequest(request())).toHaveProperty('app.siteId', 'site-b')

    let writes = 0
    const auth = await requireAppFromRequest(request('site-a'))
    if ('app' in auth) writes++
    expect(writes).toBe(0)
    expect(auth.error).toBeDefined()
    if (auth.error) {
      expect(auth.error.status).toBe(409)
      expect(await auth.error.json()).toEqual({ error: { code: 'site_changed', message: 'Selected site changed' } })
    }
  })
})
