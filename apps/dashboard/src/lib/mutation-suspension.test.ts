// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { dashboardFetch, suspendDashboardMutations } from './api-client'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})
const context = (siteId: string) => ({
  googleEnabled: false, githubEnabled: false,
  user: { id: 'user-1', name: 'Owner', email: 'owner@example.test' },
  app: { user: { id: 'user-1', name: 'Owner', email: 'owner@example.test' }, siteId, workspaceId: 'workspace-1', actor: { type: 'human', id: 'user-1', name: 'Owner', role: 'owner' } },
  apps: [], siteSetupComplete: true, siteDisplayName: 'Site',
})

describe('tenant mutation suspension', () => {
  it('aborts a pending write and prevents a later write from the stale page', async () => {
    const fetcher = vi.fn((_path: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetcher)
    const pending = dashboardFetch('/api/dashboard/posts/create', { method: 'POST', body: '{}' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    suspendDashboardMutations()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect(dashboardFetch('/api/dashboard/posts/create', { method: 'POST', body: '{}' })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('pins the tab site on mutations and broadcasts a server site_changed rejection', async () => {
    vi.resetModules()
    const client = await import('./api-client')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(context('site-a')))
      .mockResolvedValueOnce(json({ error: { code: 'site_changed', message: 'Selected site changed' } }, 409))
    vi.stubGlobal('fetch', fetcher)
    await client.loadAppRouterContext()
    const changed = vi.fn()
    client.onDashboardSiteChanged(changed)
    await expect(client.dashboardFetch('/api/dashboard/posts/create', { method: 'POST', body: '{}' }))
      .rejects.toMatchObject({ status: 409, code: 'site_changed' })
    expect(new Headers(fetcher.mock.calls[1][1].headers).get('x-vc-expected-site')).toBe('site-a')
    expect(changed).toHaveBeenCalledOnce()
    await expect(client.dashboardFetch('/api/dashboard/posts/create', { method: 'POST' })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('updates the pinned site after this tab selects another app', async () => {
    vi.resetModules()
    const client = await import('./api-client')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(context('site-a')))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ kind: 'ok', code: 'saved' }))
    vi.stubGlobal('fetch', fetcher)
    await client.loadAppRouterContext()
    await client.selectDashboardApp({ workspaceId: 'workspace-1', siteId: 'site-b' })
    await client.dashboardFetch('/api/dashboard/settings', { method: 'POST', body: '{}' })
    expect(new Headers(fetcher.mock.calls[1][1].headers).get('x-vc-expected-site')).toBe('site-a')
    expect(new Headers(fetcher.mock.calls[2][1].headers).get('x-vc-expected-site')).toBe('site-b')
    vi.unstubAllGlobals()
  })
})
