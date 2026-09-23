// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsPageData } from '~/types/dashboard'

const router = vi.hoisted(() => ({
  blockerOptions: undefined as undefined | { shouldBlockFn: (locations: {
    current: { pathname: string; search: Record<string, unknown> }
    next: { pathname: string; search: Record<string, unknown> }
  }) => boolean },
}))

vi.mock('@tanstack/react-router', () => ({
  useBlocker: (options: typeof router.blockerOptions) => {
    router.blockerOptions = options
    return { status: 'idle' as const }
  },
}))

vi.mock('~/lib/api-client', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    status = 500
  },
  getPostVersionFn: vi.fn(),
  loadPostEditorPage: vi.fn(),
  loadPostsPage: vi.fn(),
  loadSettingsPage: vi.fn(),
  updateSiteSettingsMutation: vi.fn(),
}))

import {
  loadPostsPage,
  loadSettingsPage,
  updateSiteSettingsMutation,
} from '~/lib/api-client'
import { ThemePage } from './ThemePage'

function settings(overrides: Partial<SettingsPageData['site']> = {}): SettingsPageData {
  return {
    site: {
      name: 'Agent Journal',
      description: 'Notes from the build.',
      defaultSeoTitle: 'Agent Journal',
      defaultSeoDescription: '',
      defaultSocialAssetId: null,
      theme: 'minimal',
      slug: 'agent-journal',
      themeAccent: 'teal',
      themeFont: 'geist-sans',
      themeMode: 'system',
      updatedAt: 10,
      newsletterSettings: {
        enabled: true,
        heading: 'Stay in the loop',
        subtext: 'Occasional updates.',
        buttonLabel: 'Subscribe',
      },
      ...overrides,
    },
    assets: [],
    customDomains: { domains: [], cnameTarget: null },
    billingStatus: 'active',
    selfHosted: false,
    isOwner: true,
    mcpUrl: 'https://app.example.test/mcp',
    publicBaseUrl: 'https://agent-journal.example.test',
    voiceProfile: {
      configured: false,
      audience: '',
      voiceSummary: '',
      preferRules: [],
      avoidRules: [],
      representativePostIds: [],
      warnings: [],
      updatedByName: null,
      updatedAt: null,
      publishedPosts: [],
    },
  }
}

async function settle(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }
}

describe('ThemePage', () => {
  beforeEach(() => {
    vi.mocked(loadPostsPage).mockResolvedValue({ posts: [] } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('keeps attempted choices after a stale settings conflict and retries against the refreshed version', async () => {
    vi.mocked(loadSettingsPage)
      .mockResolvedValueOnce(settings())
      .mockResolvedValueOnce(settings({
        theme: 'editorial',
        themeAccent: 'purple',
        themeFont: 'serif-editorial',
        themeMode: 'dark',
        updatedAt: 11,
      }))
      .mockResolvedValueOnce(settings({
        theme: 'technical',
        themeAccent: 'amber',
        themeFont: 'geist-mono',
        updatedAt: 12,
      }))
    vi.mocked(updateSiteSettingsMutation)
      .mockResolvedValueOnce({ kind: 'error', code: 'settings_conflict' })
      .mockResolvedValueOnce({ kind: 'ok', code: 'updated' })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<ThemePage />))
    await settle()

    const technical = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Technical'),
    )
    expect(technical).toBeTruthy()
    await act(async () => technical?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const form = container.querySelector('form')
    expect(form).toBeTruthy()
    await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()

    expect(updateSiteSettingsMutation).toHaveBeenCalledTimes(1)
    expect(updateSiteSettingsMutation).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: 10,
      theme: 'technical',
    }))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'saved theme changed elsewhere',
    )
    expect(technical?.getAttribute('aria-pressed')).toBe('true')
    expect(router.blockerOptions?.shouldBlockFn({
      current: { pathname: '/dashboard/theme', search: {} },
      next: { pathname: '/dashboard', search: {} },
    })).toBe(true)
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save changes')
    expect(retry?.hasAttribute('disabled')).toBe(false)

    await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()
    expect(updateSiteSettingsMutation).toHaveBeenCalledTimes(2)
    expect(updateSiteSettingsMutation).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedUpdatedAt: 11,
      theme: 'technical',
    }))
    expect(router.blockerOptions?.shouldBlockFn({
      current: { pathname: '/dashboard/theme', search: {} },
      next: { pathname: '/dashboard', search: {} },
    })).toBe(false)

    await act(async () => root.unmount())
    container.remove()
  })
})
