// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppRouterContext } from '~/types/dashboard'

const mock = vi.hoisted(() => ({
  suspendMutations: vi.fn(),
  siteChanged: null as null | (() => void),
  component: null as null | (() => React.ReactNode),
}))

const context: AppRouterContext = {
  googleEnabled: false, githubEnabled: false, user: { id: 'user-1', name: 'Owner', email: 'owner@example.test' },
  app: { user: { id: 'user-1', name: 'Owner', email: 'owner@example.test' }, siteId: 'site-a', workspaceId: 'workspace-a', actor: { type: 'human', id: 'user-1', name: 'Owner', role: 'owner' } },
  apps: [], siteSetupComplete: true, siteDisplayName: 'Site A',
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: () => React.ReactNode }) => {
    mock.component = options.component
    return { useRouteContext: () => context }
  },
  Outlet: () => <input data-testid="editor" defaultValue="unsaved draft" />,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
}))
vi.mock('~/components/dashboard/DashboardLayout', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('~/lib/api-client', () => ({
  suspendDashboardMutations: mock.suspendMutations,
  onDashboardSiteChanged: (listener: () => void) => {
    mock.siteChanged = listener
    return () => { mock.siteChanged = null }
  },
}))

import './route'
import { queryClient } from '~/lib/queries'

describe('dashboard site selection', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mock.siteChanged = null
    document.body.innerHTML = ''
  })

  it('keeps the unsaved editor mounted when another tab switches sites', async () => {
    const client = queryClient
    client.clear()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const Layout = mock.component!
    await act(async () => root.render(<QueryClientProvider client={client}><Layout /></QueryClientProvider>))
    const editor = container.querySelector('[data-testid="editor"]') as HTMLInputElement
    await act(async () => window.dispatchEvent(new StorageEvent('storage', {
      key: 'vc-dashboard-selection',
      newValue: JSON.stringify({ workspaceId: 'workspace-b', siteId: 'site-b', siteName: 'Site B' }),
    })))
    expect(container.querySelector('[data-testid="editor"]')).toBe(editor)
    expect(editor.value).toBe('unsaved draft')
    expect(container.textContent).toContain('You switched to Site B in another tab')
    expect(mock.suspendMutations).toHaveBeenCalled()
    await act(async () => root.unmount())
    container.remove()
  })

  it('does not pause or unmount the editor on focus', async () => {
    queryClient.clear()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const Layout = mock.component!
    await act(async () => root.render(<QueryClientProvider client={queryClient}><Layout /></QueryClientProvider>))
    const editor = container.querySelector('[data-testid="editor"]')
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(container.querySelector('[data-testid="editor"]')).toBe(editor)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mock.suspendMutations).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    container.remove()
  })

  it('shows a site_changed response banner without unmounting the editor', async () => {
    queryClient.clear()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const Layout = mock.component!
    await act(async () => root.render(<QueryClientProvider client={queryClient}><Layout /></QueryClientProvider>))
    const editor = container.querySelector('[data-testid="editor"]')
    await act(async () => mock.siteChanged?.())
    expect(container.querySelector('[data-testid="editor"]')).toBe(editor)
    expect(container.textContent).toContain('You switched to another site in another tab')
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps the editor mounted when refreshed context selects another site', async () => {
    queryClient.clear()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const Layout = mock.component!
    await act(async () => root.render(<QueryClientProvider client={queryClient}><Layout /></QueryClientProvider>))
    const editor = container.querySelector('[data-testid="editor"]')
    await act(async () => {
      queryClient.setQueryData(['context'], {
        ...context,
        app: { ...context.app!, siteId: 'site-b' },
        siteDisplayName: 'Site B',
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(container.querySelector('[data-testid="editor"]')).toBe(editor)
    expect(container.textContent).toContain('You switched to Site B in another tab')
    expect(mock.suspendMutations).toHaveBeenCalled()
    await act(async () => root.unmount())
    container.remove()
  })
})
