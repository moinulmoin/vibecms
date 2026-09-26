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
      logoAssetId: null,
      faviconAssetId: null,
      navLinks: [],
      socialLinks: [],
      theme: 'minimal',
      slug: 'agent-journal',
      themeAccent: 'teal',
      themeFont: 'geist-sans',
      themeMode: 'system',
      themeRadius: 'md',
      themeWidth: 'normal',
      bylineName: '',
      showAgentCredit: true,
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
      button.textContent?.includes('Notebook'),
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

  it('shows identity and links in the gallery and main preview', async () => {
    vi.mocked(loadSettingsPage).mockResolvedValue(settings({
      logoAssetId: 'logo-1',
      navLinks: [{ label: 'About', url: '/about' }],
      socialLinks: [{ kind: 'github', url: 'https://github.com/example' }],
    }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<ThemePage />))
    await settle()
    expect(container.querySelectorAll('img[src="/media-assets/logo-1"]').length).toBeGreaterThan(1)
    const preview = container.querySelector('[aria-label="Theme preview"]')
    expect(preview?.querySelector('a[href="/about"]')?.textContent).toBe('About')
    expect(preview?.querySelector('a[aria-label="GitHub"]')).toBeTruthy()
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps theme controls read-only for editors', async () => {
    vi.mocked(loadSettingsPage).mockResolvedValue({ ...settings(), isOwner: false })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<ThemePage />))
    await settle()
    expect(container.textContent).toContain('Only the owner can change these.')
    expect(container.querySelector<HTMLButtonElement>('[role="radiogroup"][aria-label="Template"] button')?.disabled).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[role="radiogroup"][aria-label="Accent color"] button')?.disabled).toBe(true)
    expect(container.textContent).not.toContain('Save changes')
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(updateSiteSettingsMutation).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    container.remove()
  })

  it('previews the live version of each post on Home, not pending edits', async () => {
    vi.mocked(loadSettingsPage).mockResolvedValue(settings())
    vi.mocked(loadPostsPage).mockResolvedValue({
      posts: [{
        id: 'post-1', title: 'Working title', excerpt: 'Working excerpt', tags: ['draft'], publishedAt: 10,
        published: { title: 'Live title', excerpt: 'Live excerpt', tags: ['live'] },
      }],
    } as never)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<ThemePage />))
    await settle()
    const home = [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Preview page"] button')]
      .find((button) => button.textContent === 'Home')
    await act(async () => home?.click())
    expect(container.textContent).toContain('Showing your published posts.')
    expect(container.textContent).toContain('Live title')
    expect(container.textContent).not.toContain('Working title')
    await act(async () => root.unmount())
    container.remove()
  })
})
