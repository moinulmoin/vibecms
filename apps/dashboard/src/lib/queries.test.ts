// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardApiError, dashboardFetch, onDashboardMutation, selectDashboardApp } from '~/lib/api-client'
import { createDashboardQueryClient, markDashboardDataStale, queryClient, queryKeys, settingsQuery, signedOutContext } from '~/lib/queries'
import { saveTokenFlash } from '~/lib/token-flash'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('cross-page cache freshness', () => {
  it('uses a different tenant key for settings and posts after the selected site changes', () => {
    const selected = (siteId: string) => ({
      ...signedOutContext,
      app: { user: { id: 'u', name: 'Owner', email: 'owner@example.test' }, siteId, workspaceId: 'w', actor: { type: 'human' as const, id: 'u', name: 'Owner', role: 'owner' as const } },
    })
    queryClient.setQueryData(queryKeys.context, selected('site-a'))
    const settingsA = settingsQuery.queryKey
    const postsA = queryKeys.posts({})
    queryClient.setQueryData(queryKeys.context, selected('site-b'))
    expect(settingsQuery.queryKey).not.toEqual(settingsA)
    expect(queryKeys.posts({})).not.toEqual(postsA)
    queryClient.clear()
  })
  it('notifies mutation listeners after writes, never after reads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ kind: 'ok', code: 'saved' })))
    const listener = vi.fn()
    const off = onDashboardMutation(listener)
    try {
      await dashboardFetch('/api/dashboard/settings', { method: 'GET' })
      expect(listener).not.toHaveBeenCalled()
      await dashboardFetch('/api/dashboard/settings', { method: 'POST', body: '{}' })
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it('still notifies when the write fails (the server may have applied it)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'x', message: 'boom' } }, 500)))
    const listener = vi.fn()
    const off = onDashboardMutation(listener)
    try {
      await expect(dashboardFetch('/api/dashboard/settings', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(
        DashboardApiError,
      )
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it('marks cached pages stale (e.g. Settings after a theme save) but keeps the session context', () => {
    const client = createDashboardQueryClient()
    client.setQueryData(queryKeys.settings, { site: { updatedAt: 1 } })
    client.setQueryData(queryKeys.posts({}), { posts: [] })
    client.setQueryData(queryKeys.context, signedOutContext)

    markDashboardDataStale(client)

    expect(client.getQueryState(queryKeys.settings)?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.posts({}))?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.context)?.isInvalidated).toBe(false)
  })
})

describe('expired session', () => {
  let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>

  beforeEach(() => {
    assign = vi.fn<(url: string | URL) => void>()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/dashboard/settings', assign })
  })

  it('a page query answering 401 drops cached data and the one-time key, then goes to login', async () => {
    const client = createDashboardQueryClient()
    client.setQueryData(queryKeys.overview, { counts: {} })
    saveTokenFlash({ token: 'vc_secret', name: 'My agent', id: 'k1' })

    await client
      .fetchQuery({
        queryKey: queryKeys.settings,
        queryFn: () => Promise.reject(new DashboardApiError(401, 'UNAUTHORIZED', 'Authentication required')),
      })
      .catch(() => undefined)

    expect(assign).toHaveBeenCalledWith('/login')
    expect(client.getQueryData(queryKeys.overview)).toBeUndefined()
    expect(sessionStorage.getItem('vc_token_flash')).toBeNull()
    expect(sessionStorage.getItem('vc_activation_key_id')).toBeNull()
  })

  it('ignores other errors and the context query (signed-out is a valid context)', async () => {
    const client = createDashboardQueryClient()
    await client
      .fetchQuery({
        queryKey: queryKeys.context,
        queryFn: () => Promise.reject(new DashboardApiError(401, 'UNAUTHORIZED', 'x')),
      })
      .catch(() => undefined)
    await client
      .fetchQuery({
        queryKey: queryKeys.settings,
        queryFn: () => Promise.reject(new DashboardApiError(500, 'internal', 'x')),
        retry: false,
      })
      .catch(() => undefined)
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('pinned tenant keys', () => {
  it('keeps a mounted page on its own site after another tab switches the selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await selectDashboardApp({ workspaceId: 'w', siteId: 'site-a' })
    const selected = (siteId: string) => ({
      ...signedOutContext,
      app: { user: { id: 'u', name: 'Owner', email: 'owner@example.test' }, siteId, workspaceId: 'w', actor: { type: 'human' as const, id: 'u', name: 'Owner', role: 'owner' as const } },
    })
    queryClient.setQueryData(queryKeys.context, selected('site-a'))
    const before = settingsQuery.queryKey
    queryClient.setQueryData(queryKeys.context, selected('site-b'))
    expect(settingsQuery.queryKey).toEqual(before)
    expect(settingsQuery.queryKey).toContain('site-a')
    queryClient.clear()
  })
})
