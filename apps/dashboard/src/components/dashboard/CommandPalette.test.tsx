// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mock.navigate }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({
    isFetching: false,
    data: {
      posts: [{ id: 'p1', title: 'Shipping notes', slug: 'shipping-notes', status: 'draft' }],
      publicBaseUrl: 'https://notes.example.com',
      hasMore: false,
    },
  }),
}))
vi.mock('~/lib/api-client', () => ({ loadPostsPage: vi.fn() }))

import { CommandPalette, matchesQuery } from './CommandPalette'

const press = (key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CommandPalette', () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

  it('matches every word against labels and keywords', () => {
    expect(matchesQuery({ label: 'Theme', keywords: 'design accent font' }, 'acc')).toBe(true)
    expect(matchesQuery({ label: 'Plan & billing', keywords: 'subscription' }, 'plan sub')).toBe(true)
    expect(matchesQuery({ label: 'Media', keywords: 'images' }, 'theme')).toBe(false)
  })

  it('opens with Cmd+K, filters as you type, and opens the highlighted result with Enter', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<CommandPalette role="owner" />))
    await act(async () => { press('k', { metaKey: true }) })
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search posts, pages, and actions"]')!
    expect(input).toBeTruthy()
    expect(document.body.textContent).toContain('Recent posts')
    expect(document.body.textContent).toContain('Open your blog')
    await act(async () => setValue(input, 'voice'))
    const options = [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    expect(options).toContain('Voice')
    expect(options).not.toContain('Media')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(mock.navigate).toHaveBeenCalledWith({ to: '/dashboard/settings', search: { ok: undefined, error: undefined, tab: 'voice' } })
    await act(async () => root.unmount())
  })

  it('leaves Cmd+K to the editor when it already handled it, and hides owner pages from viewers', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<CommandPalette role="viewer" />))
    await act(async () => {
      const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true })
      event.preventDefault()
      window.dispatchEvent(event)
    })
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await act(async () => { press('k', { ctrlKey: true }) })
    const labels = [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    expect(labels).toContain('Analytics')
    expect(labels).not.toContain('Plan & billing')
    expect(labels).not.toContain('New post')
    await act(async () => root.unmount())
  })
})
