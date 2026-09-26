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
  updateVoiceProfileMutation: vi.fn(),
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
    isOwner: false,
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
})
