// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withQueryClient } from '~/test/query'

const mocks = vi.hoisted(() => ({
  createApiKeyMutation: vi.fn(),
  loadConnectPage: vi.fn(),
  loadOnboardingStatus: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a> }))
vi.mock('~/lib/api-client', () => ({
  DashboardApiError: class DashboardApiError extends Error { status = 500 },
  createApiKeyMutation: mocks.createApiKeyMutation,
  loadConnectPage: mocks.loadConnectPage,
  loadOnboardingStatus: mocks.loadOnboardingStatus,
  savePersonalizationMutation: vi.fn(),
}))
vi.mock('~/lib/token-flash', () => ({
  consumeTokenFlash: () => null,
  saveTokenFlash: vi.fn(),
  clearTokenFlash: vi.fn(),
}))

import { PersonalizePage } from './PersonalizePage'

async function renderPage() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(withQueryClient(<PersonalizePage />)))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { container, cleanup: async () => { await act(async () => root.unmount()); container.remove() } }
}

describe('PersonalizePage', () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

  it('creates the onboarding key with draft access', async () => {
    mocks.loadConnectPage.mockResolvedValue({
      canManage: true, apiKeys: [], mcpUrl: 'https://example.test/mcp',
      effectiveEntitlement: { effective: false }, personalization: { agentPreference: null },
    })
    mocks.loadOnboardingStatus.mockResolvedValue({ connection: 'waiting', firstPost: { state: 'none' } })
    mocks.createApiKeyMutation.mockResolvedValue({ kind: 'ok', token: 'vc_test', id: 'key-1', name: 'My agent' })
    const page = await renderPage()
    expect(mocks.createApiKeyMutation).toHaveBeenCalledWith(expect.objectContaining({ preset: 'draft' }))
    expect(page.container.textContent).toContain('This key can save drafts.')
    await page.cleanup()
  })

  it('hides the free-plan offer for active paid access and calls a live post the latest', async () => {
    mocks.loadConnectPage.mockResolvedValue({
      canManage: true, apiKeys: [{ id: 'key-1' }], mcpUrl: 'https://example.test/mcp',
      effectiveEntitlement: { effective: true }, personalization: { agentPreference: null },
    })
    mocks.loadOnboardingStatus.mockResolvedValue({
      connection: 'connected',
      firstPost: { state: 'live', post: { id: 'post-1', title: 'Post', slug: 'post', publishedAt: 10, url: null }, actorName: 'Agent' },
    })
    const page = await renderPage()
    expect(page.container.textContent).toContain('Your latest post is live.')
    expect(page.container.textContent).not.toContain('The free plan includes')
    await page.cleanup()
  })
})
