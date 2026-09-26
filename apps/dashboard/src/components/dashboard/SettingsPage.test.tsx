// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SettingsPageData } from '~/types/dashboard'

const api = vi.hoisted(() => ({
  blockerOptions: undefined as undefined | { shouldBlockFn: (locations: {
    current: { pathname: string; search: Record<string, unknown> }
    next: { pathname: string; search: Record<string, unknown> }
  }) => boolean },
  loadSettingsPage: vi.fn(),
  navigate: vi.fn(),
  updateSiteSettingsMutation: vi.fn(),
  updateVoiceProfileMutation: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
  useBlocker: (options: typeof api.blockerOptions) => {
    api.blockerOptions = options
    return { status: 'idle' as const }
  },
  useNavigate: () => api.navigate,
  useSearch: () => ({ tab: undefined }),
}))

vi.mock('~/lib/api-client', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    status = 500
  },
  addCustomDomainMutation: vi.fn(),
  clearVoiceProfileMutation: vi.fn(),
  loadSettingsPage: api.loadSettingsPage,
  removeCustomDomainMutation: vi.fn(),
  updateSiteSettingsMutation: api.updateSiteSettingsMutation,
  updateVoiceProfileMutation: api.updateVoiceProfileMutation,
}))

vi.mock('~/components/dashboard/DashboardLayout', () => ({
  Button: ({ asChild, children, ...props }: { asChild?: boolean; children?: ReactNode }) => (
    asChild ? children : <button {...props}>{children}</button>
  ),
  LoadError: ({ message }: { message: string }) => <p>{message}</p>,
}))

vi.mock('~/components/dashboard/blocks', () => ({
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
  ListRow: () => null,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  PageSkeleton: () => <p>Loading</p>,
  PageTabs: () => null,
  Panel: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  Section: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  StatusBadge: () => null,
}))

vi.mock('~/components/dashboard/BillingPage', () => ({ PlanAndBilling: () => null }))

vi.mock('~/components/ui/tabs', () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
}))

vi.mock('~/components/ui/toggle-group', () => ({
  ToggleGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
}))

vi.mock('~/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children?: ReactNode }) => children,
}))

vi.mock('~/components/ui/checkbox', () => ({
  Checkbox: ({ checked, disabled, id, onCheckedChange }: {
    checked: boolean
    disabled?: boolean
    id?: string
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      checked={checked}
      disabled={disabled}
      id={id}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      type="checkbox"
    />
  ),
}))

vi.mock('~/components/dashboard/PendingSubmitButton', () => ({
  PendingSubmitButton: ({ children, disabled }: { children?: ReactNode; disabled?: boolean }) => (
    <button disabled={disabled} type="submit">{children}</button>
  ),
}))

vi.mock('~/components/dashboard/SpaConfirmButton', () => ({
  SpaConfirmButton: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
}))

import { SettingsPage } from './SettingsPage'
import { withQueryClient } from '~/test/query'
import { queryKeys } from '~/lib/queries'

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
    billingStatus: 'none',
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
      publishedPosts: [{ id: 'post-1', title: 'A strong example', slug: 'strong-example', updatedAt: 10 }],
    },
  }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

describe('SettingsPage', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('adds and removes link rows; empty rows stay quiet until a save attempt', async () => {
    api.loadSettingsPage.mockResolvedValue(settings())
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<SettingsPage />)))
    await settle()
    const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
    await act(async () => button('Add link')?.click())
    expect(container.querySelector('[aria-label="Navigation 1 label"]')).toBeTruthy()
    expect(container.textContent).not.toContain('Enter a URL')
    const form = container.querySelector('#site-name')?.closest('form')
    await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.updateSiteSettingsMutation).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Enter a URL')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove navigation 1"]')?.click())
    expect(container.querySelector('[aria-label="Navigation 1 label"]')).toBeNull()
    await act(async () => button('Add social link')?.click())
    expect(container.querySelector('[aria-label="Social 1 URL"]')?.getAttribute('aria-invalid')).toBe('true')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove social 1"]')?.click())
    expect(container.querySelector('[aria-label="Social 1 URL"]')).toBeNull()
    await act(async () => root.unmount())
    container.remove()
  })

  it('enables saving when a representative voice post is selected', async () => {
    api.loadSettingsPage.mockResolvedValue(settings())
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => root.render(withQueryClient(<SettingsPage />)))
    await settle()

    const checkbox = container.querySelector<HTMLInputElement>('#post-post-1')
    const voiceForm = checkbox?.closest('form')
    const save = [...(voiceForm?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Saved')
    expect(checkbox).toBeTruthy()
    expect(save?.disabled).toBe(true)

    await act(async () => checkbox?.click())

    const enabledSave = [...(voiceForm?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Save changes')
    expect(enabledSave?.disabled).toBe(false)
    expect(api.blockerOptions?.shouldBlockFn({
      current: { pathname: '/dashboard/settings', search: { tab: 'voice' } },
      next: { pathname: '/dashboard', search: {} },
    })).toBe(true)

    await act(async () => root.unmount())
    container.remove()
  })

  it('offers uploaded images for logo and favicon in the site save', async () => {
    const loaded = settings()
    loaded.assets = [{ id: 'image-1', siteId: 'site-1', r2Key: 'image-1', filename: 'mark.png', mimeType: 'image/png', sizeBytes: 42, width: 32, height: 32, altText: null, createdAt: 1, updatedAt: 1 }]
    api.loadSettingsPage.mockResolvedValue(loaded)
    api.updateSiteSettingsMutation.mockResolvedValue({ kind: 'ok', code: 'site_saved' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<SettingsPage />)))
    await settle()
    const logo = container.querySelector<HTMLSelectElement>('#logoAssetId')!
    const favicon = container.querySelector<HTMLSelectElement>('#faviconAssetId')!
    expect([...logo.options].map((option) => option.textContent)).toContain('mark.png')
    await act(async () => {
      logo.value = 'image-1'
      logo.dispatchEvent(new Event('change', { bubbles: true }))
      favicon.value = 'image-1'
      favicon.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelectorAll('img[src="/media-assets/image-1"]').length).toBe(2)
    await act(async () => logo.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.updateSiteSettingsMutation).toHaveBeenCalledWith(expect.objectContaining({ logoAssetId: 'image-1', faviconAssetId: 'image-1' }))
    await act(async () => root.unmount())
    container.remove()
  })

  it('saves the public byline and agent credit with the site form', async () => {
    api.loadSettingsPage.mockResolvedValue(settings())
    api.updateSiteSettingsMutation.mockResolvedValue({ kind: 'ok', code: 'site_saved' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => root.render(withQueryClient(<SettingsPage />)))
    await settle()

    const byline = container.querySelector<HTMLInputElement>('#site-byline-name')
    const credit = container.querySelector<HTMLButtonElement>('#site-agent-credit')
    const siteForm = byline?.closest('form')
    expect(byline?.placeholder).toBe('Agent Journal')
    expect(container.textContent).toContain('Your email is never shown.')
    expect(credit?.getAttribute('aria-checked')).toBe('true')
    const saveButton = () => [...(siteForm?.querySelectorAll('button') ?? [])].find((button) => /Save/.test(button.textContent ?? ''))
    expect(saveButton()?.disabled).toBe(true)

    await act(async () => credit?.click())
    expect(credit?.getAttribute('aria-checked')).toBe('false')
    expect(saveButton()?.disabled).toBe(false)

    await act(async () => {
      if (!byline) return
      byline.value = '  Ada  '
      byline.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => siteForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()

    expect(api.updateSiteSettingsMutation).toHaveBeenCalledWith(expect.objectContaining({
      bylineName: 'Ada',
      showAgentCredit: false,
    }))

    await act(async () => root.unmount())
    container.remove()
  })

  it('preserves local site fields after a stale settings conflict', async () => {
    api.loadSettingsPage
      .mockResolvedValueOnce(settings())
      .mockResolvedValueOnce(settings({ name: 'Remote name', updatedAt: 11 }))
    api.updateSiteSettingsMutation.mockResolvedValue({ kind: 'error', code: 'settings_conflict' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => root.render(withQueryClient(<SettingsPage />)))
    await settle()

    const name = container.querySelector<HTMLInputElement>('#site-name')
    const siteForm = name?.closest('form')
    expect(name).toBeTruthy()
    await act(async () => {
      if (!name) return
      name.value = 'My local name'
      name.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => siteForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()

    expect(api.updateSiteSettingsMutation).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: 10,
      name: 'My local name',
    }))
    expect(name?.value).toBe('My local name')
    const retry = [...(siteForm?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Save changes')
    expect(retry?.disabled).toBe(false)
    expect(api.blockerOptions?.shouldBlockFn({
      current: { pathname: '/dashboard/settings', search: {} },
      next: { pathname: '/dashboard/settings', search: { error: 'settings_conflict' } },
    })).toBe(false)

    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps the draft conflict token after a background settings refetch', async () => {
    api.loadSettingsPage
      .mockResolvedValueOnce(settings())
      .mockResolvedValueOnce(settings({ bylineName: 'Remote author', updatedAt: 11 }))
    api.updateSiteSettingsMutation.mockResolvedValue({ kind: 'error', code: 'settings_conflict' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>))
    await settle()
    const byline = container.querySelector<HTMLInputElement>('#site-byline-name')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(byline, 'Local author')
      byline.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await client.refetchQueries({ queryKey: ['settings'] }) })
    await settle()
    expect(api.loadSettingsPage).toHaveBeenCalledTimes(2)
    expect(client.getQueryData<{ site: { updatedAt: number } }>(queryKeys.settings)?.site.updatedAt).toBe(11)
    expect(container.textContent).toContain('Settings changed elsewhere, reload')
    expect(byline.value).toBe('Local author')
    await act(async () => byline.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.updateSiteSettingsMutation).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: 10,
      bylineName: 'Local author',
    }))
    await act(async () => root.unmount())
    container.remove()
  })

  it('does not erase site fields changed while a successful save is in flight', async () => {
    let resolveSave: ((result: { kind: 'ok'; code: string }) => void) | undefined
    api.loadSettingsPage
      .mockResolvedValueOnce(settings())
      .mockResolvedValueOnce(settings({ name: 'Submitted name', updatedAt: 11 }))
    api.updateSiteSettingsMutation.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => root.render(withQueryClient(<SettingsPage />)))
    await settle()

    const name = container.querySelector<HTMLInputElement>('#site-name')
    const siteForm = name?.closest('form')
    await act(async () => {
      if (!name) return
      name.value = 'Submitted name'
      name.dispatchEvent(new Event('change', { bubbles: true }))
      siteForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await act(async () => {
      if (!name) return
      name.value = 'Newer local name'
      name.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => resolveSave?.({ kind: 'ok', code: 'settings_updated' }))
    await settle()

    expect(name?.value).toBe('Newer local name')
    const save = [...(siteForm?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Save changes')
    expect(save?.disabled).toBe(false)

    await act(async () => root.unmount())
    container.remove()
  })

  it('preserves only voice fields edited after submitting while saving', async () => {
    let resolveSave: ((result: { kind: 'ok'; code: string }) => void) | undefined
    api.loadSettingsPage
      .mockResolvedValueOnce(settings())
      .mockResolvedValueOnce({ ...settings(), voiceProfile: { ...settings().voiceProfile, audience: 'Submitted audience', voiceSummary: 'Saved tone' } })
    api.updateVoiceProfileMutation.mockReturnValue(new Promise((resolve) => { resolveSave = resolve }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<SettingsPage />)))
    await settle()

    const audience = container.querySelector<HTMLTextAreaElement>('#voice-audience')!
    const tone = container.querySelector<HTMLTextAreaElement>('#voice-summary')!
    const voiceForm = audience.closest('form')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(audience, 'Submitted audience')
      audience.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(tone, 'Saved tone')
      tone.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { voiceForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(audience, 'Newer audience')
      audience.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => resolveSave?.({ kind: 'ok', code: 'voice_saved' }))
    await settle()

    expect(audience.value).toBe('Newer audience')
    expect(tone.value).toBe('Saved tone')
    expect([...voiceForm.querySelectorAll('button')].some((button) => button.textContent === 'Save changes' && !button.disabled)).toBe(true)
    await act(async () => root.unmount())
    container.remove()
  })

  it('makes editor settings read-only with no save controls', async () => {
    api.loadSettingsPage.mockResolvedValue({ ...settings(), isOwner: false })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(withQueryClient(<SettingsPage canEdit={false} />)))
    await settle()
    expect(container.textContent).toContain('Only the owner can change these.')
    expect(container.querySelector<HTMLInputElement>('#site-name')?.closest('fieldset')?.disabled).toBe(true)
    expect(container.querySelector<HTMLTextAreaElement>('#voice-audience')?.closest('fieldset')?.disabled).toBe(true)
    expect(container.textContent).not.toContain('Save changes')
    expect(container.textContent).not.toContain('Saved')
    await act(async () => root.unmount())
    container.remove()
  })
})
