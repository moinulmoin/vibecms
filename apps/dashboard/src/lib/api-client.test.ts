import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardApiError, dashboardFetch, dashboardPost, loadOnboardingStatus } from '~/lib/api-client'
import { mutationResultSchema } from '~/lib/dashboard-response-schemas'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dashboardFetch', () => {
  it('throws DashboardApiError on 401 with same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Sign in required' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(dashboardFetch('/api/dashboard/context', { method: 'GET' })).rejects.toMatchObject({
      name: 'DashboardApiError',
      status: 401,
      code: 'unauthorized',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard/context',
      expect.objectContaining({ credentials: 'same-origin', method: 'GET' }),
    )
  })

  it('parses success JSON with a Zod schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ kind: 'ok', code: 'saved' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const result = await dashboardFetch('/api/dashboard/settings', { method: 'POST', body: '{}' }, mutationResultSchema)
    expect(result).toEqual({ kind: 'ok', code: 'saved' })
  })

  it('maps API error envelopes on non-OK responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Not allowed' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(dashboardFetch('/api/dashboard/overview', { method: 'GET' })).rejects.toBeInstanceOf(
      DashboardApiError,
    )
  })
})

describe('dashboardPost', () => {
  it('does not retry failed mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'unknown', message: 'fail' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(dashboardPost('/api/dashboard/setup', { name: 'x', slug: 'x' })).rejects.toBeInstanceOf(
      DashboardApiError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('loadOnboardingStatus', () => {
  it('encodes keyId as a query parameter when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          canManage: true,
          mcpUrl: 'https://app.example.com/api/mcp',
          publicBaseUrl: 'https://app.example.com',
          key: null,
          connection: 'no_token',
          firstPost: { state: 'waiting' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await loadOnboardingStatus({ keyId: 'key_abc+123' })

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('keyId=key_abc%2B123')
  })

  it('omits keyId from the URL when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          canManage: true,
          mcpUrl: 'https://app.example.com/api/mcp',
          publicBaseUrl: null,
          key: null,
          connection: 'no_token',
          firstPost: { state: 'waiting' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await loadOnboardingStatus()

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toBe('/api/dashboard/onboarding-status')
  })
})