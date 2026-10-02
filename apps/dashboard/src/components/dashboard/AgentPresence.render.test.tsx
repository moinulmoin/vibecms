// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  invalidate: vi.fn(),
  keys: [] as Array<{ id: string; name: string; tokenPrefix: string; scopes: string[]; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }>,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: { apiKeys: mock.keys } }),
  useQueryClient: () => ({ invalidateQueries: mock.invalidate }),
}))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a> }))
vi.mock('~/lib/queries', () => ({
  connectQuery: { queryKey: ['connect'] },
  queryKeys: { overview: ['overview'], postsAll: ['posts'], activityAll: ['activity'] },
}))

import { AgentPresence } from './AgentPresence'

describe('AgentPresence refresh', () => {
  it('refreshes the views on the first agent request after load, even when no agent had worked yet', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mock.keys = [{ id: 'k1', name: 'My agent', tokenPrefix: 'vc_a', scopes: [], createdAt: 0, lastUsedAt: null, revokedAt: null }]
    await act(async () => root.render(<AgentPresence role="owner" />))
    expect(mock.invalidate).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
    mock.keys = [{ ...mock.keys[0]!, lastUsedAt: Math.floor(Date.now() / 1000) }]
    await act(async () => root.render(<AgentPresence role="owner" />))
    expect(mock.invalidate).toHaveBeenCalledWith({ queryKey: ['posts'] })
    expect(host.textContent).toContain('My agent is working')
    await act(async () => root.unmount())
    host.remove()
  })
})
