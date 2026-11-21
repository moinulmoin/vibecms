// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppRouterContext } from '~/types/dashboard'

const mock = vi.hoisted(() => ({
  options: null as null | { beforeLoad: (input: { search: Record<string, unknown>; context: AppRouterContext }) => unknown },
  selectApp: vi.fn(async () => {}),
  suspendMutations: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: typeof mock.options) => {
    mock.options = options
    return {}
  },
  redirect: (target: unknown) => ({ redirect: target }),
}))
vi.mock('~/lib/api-client', () => ({ selectDashboardApp: mock.selectApp, suspendDashboardMutations: mock.suspendMutations }))
vi.mock('~/lib/auth-client', () => ({ setupAuthClient: vi.fn() }))

import './billing'

const owner = { id: 'user-1', name: 'Owner', email: 'owner@example.test' }
const context: AppRouterContext = {
  googleEnabled: false,
  githubEnabled: false,
  user: owner,
  app: { user: owner, siteId: 'site-a', workspaceId: 'workspace-a', actor: { type: 'human', id: 'user-1', name: 'Owner', role: 'owner' } },
  apps: [
    { workspaceId: 'workspace-a', siteId: 'site-a', siteName: 'Site A' },
    { workspaceId: 'workspace-b', siteId: 'site-b', siteName: 'Site B' },
  ] as AppRouterContext['apps'],
  siteSetupComplete: true,
  siteDisplayName: 'Site A',
}

describe('billing link from a failed-payment email', () => {
  afterEach(() => vi.clearAllMocks())

  it("opens the named blog's billing when it is not the selected one", async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    void mock.options!.beforeLoad({ search: { site: 'site-b' }, context })
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard/settings?tab=billing'))
    expect(mock.selectApp).toHaveBeenCalledWith({ workspaceId: 'workspace-b', siteId: 'site-b' })
  })

  it("never shows the selected blog's billing for a blog this account cannot open", async () => {
    await expect(mock.options!.beforeLoad({ search: { site: 'site-elsewhere' }, context })).resolves.toBeUndefined()
    expect(mock.selectApp).not.toHaveBeenCalled()
  })

  it('goes straight to Plan & billing for the selected blog', async () => {
    await expect(mock.options!.beforeLoad({ search: { site: 'site-a' }, context })).rejects.toMatchObject({
      redirect: { to: '/dashboard/settings', search: { tab: 'billing' } },
    })
  })
})
