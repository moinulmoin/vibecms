// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withQueryClient } from '~/test/query'

const mocks = vi.hoisted(() => ({
  loadSubscribersPage: vi.fn(),
  loadNewsletterSettings: vi.fn(),
  deleteSubscriberMutation: vi.fn(),
  updateNewsletterSettingsMutation: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useBlocker: () => ({ status: 'idle' }),
}))
vi.mock('~/lib/api-client', () => ({
  DashboardApiError: class DashboardApiError extends Error { status = 400 },
  loadSubscribersPage: mocks.loadSubscribersPage,
  loadNewsletterSettings: mocks.loadNewsletterSettings,
  deleteSubscriberMutation: mocks.deleteSubscriberMutation,
  updateNewsletterSettingsMutation: mocks.updateNewsletterSettingsMutation,
  subscribersExportUrl: () => '/export',
}))
vi.mock('~/components/Toaster', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('~/components/dashboard/SpaConfirmButton', () => ({
  SpaConfirmButton: ({ onConfirm, children, ...props }: { onConfirm: () => void; children: ReactNode }) =>
    <button type="button" onClick={onConfirm} {...props}>{children}</button>,
}))
vi.mock('~/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('~/components/dashboard/blocks', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  PageSkeleton: () => <p>Loading</p>,
  PageTabs: () => null,
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
  StatusBadge: () => null,
}))

import { SubscribersPage } from './SubscribersPage'
import { DashboardApiError } from '~/lib/api-client'

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function render(search: { q: undefined; status: undefined; page: number; tab?: 'form' }, canExport = false) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(withQueryClient(<SubscribersPage search={search} canExport={canExport} />)))
  await settle()
  return { container, cleanup: async () => { await act(async () => root.unmount()); container.remove() } }
}

describe('SubscribersPage', () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

  it('returns to the last valid page after deleting its only row', async () => {
    let deleted = false
    mocks.loadSubscribersPage.mockImplementation(async ({ offset }: { offset: number }) => ({
      rows: offset === 50 && !deleted ? [{ id: 'last', email: 'last@example.test', status: 'confirmed', createdAt: 10, sourceUrl: null }] : [],
      total: deleted ? 50 : 51,
      pendingCount: 0,
    }))
    mocks.deleteSubscriberMutation.mockImplementation(async () => { deleted = true; return { kind: 'ok' } })
    const page = await render({ q: undefined, status: undefined, page: 2 })
    await act(async () => page.container.querySelector<HTMLButtonElement>('[aria-label="Remove last@example.test"]')?.click())
    await settle()
    expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({
      to: '/dashboard/subscribers',
      search: expect.objectContaining({ page: 1 }),
    }))
    await page.cleanup()
  })

  it('shows field errors and blocks blank required signup settings', async () => {
    mocks.loadSubscribersPage.mockResolvedValue({ rows: [], total: 0, pendingCount: 0 })
    mocks.loadNewsletterSettings.mockResolvedValue({ enabled: true, heading: 'Updates', subtext: 'Occasional notes', buttonLabel: 'Subscribe' })
    const page = await render({ q: undefined, status: undefined, page: 1, tab: 'form' }, true)
    const description = page.container.querySelector<HTMLTextAreaElement>('#newsletter-subtext')!
    const button = page.container.querySelector<HTMLInputElement>('#newsletter-button-label')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(description, '   ')
      description.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(button, '')
      button.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(description.getAttribute('aria-invalid')).toBe('true')
    expect(button.getAttribute('aria-invalid')).toBe('true')
    expect(page.container.querySelector('#newsletter-subtext-error')?.textContent).toBeTruthy()
    expect(page.container.querySelector('#newsletter-button-label-error')?.textContent).toBeTruthy()
    page.container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(mocks.updateNewsletterSettingsMutation).not.toHaveBeenCalled()
    await page.cleanup()
  })

  it('does not call a 400 response a connection problem', async () => {
    mocks.loadSubscribersPage.mockResolvedValue({ rows: [], total: 0, pendingCount: 0 })
    mocks.loadNewsletterSettings.mockResolvedValue({ enabled: true, heading: 'Updates', subtext: 'Occasional notes', buttonLabel: 'Subscribe' })
    mocks.updateNewsletterSettingsMutation.mockRejectedValue(new DashboardApiError(400, 'invalid_settings', 'Invalid settings'))
    const page = await render({ q: undefined, status: undefined, page: 1, tab: 'form' }, true)
    const heading = page.container.querySelector<HTMLInputElement>('#newsletter-heading')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(heading, 'New updates')
      heading.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => page.container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Check the signup form fields and try again.' }))
    await page.cleanup()
  })

  it('shows validation feedback for an API validation result', async () => {
    mocks.loadSubscribersPage.mockResolvedValue({ rows: [], total: 0, pendingCount: 0 })
    mocks.loadNewsletterSettings.mockResolvedValue({ enabled: true, heading: 'Updates', subtext: 'Occasional notes', buttonLabel: 'Subscribe' })
    mocks.updateNewsletterSettingsMutation.mockResolvedValue({ kind: 'error', code: 'validation_error' })
    const page = await render({ q: undefined, status: undefined, page: 1, tab: 'form' }, true)
    const heading = page.container.querySelector<HTMLInputElement>('#newsletter-heading')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(heading, 'New updates')
      heading.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => page.container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Check the signup form fields and try again.' }))
    await page.cleanup()
  })
})
