// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SiteLocationCheck, SiteLocationView } from '~/types/dashboard'

const api = vi.hoisted(() => ({
  checkSubpathLocationMutation: vi.fn(),
  removeSubpathLocationMutation: vi.fn(),
  rotateSubpathLocationMutation: vi.fn(),
  setSubpathLocationMutation: vi.fn(),
}))

vi.mock('~/lib/api-client', () => api)

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))

vi.mock('~/components/dashboard/DashboardLayout', () => ({
  Button: ({ asChild, children, ...props }: { asChild?: boolean; children?: ReactNode }) => (
    asChild ? children : <button {...props}>{children}</button>
  ),
  formatRelative: () => 'just now',
}))

vi.mock('~/components/dashboard/blocks', () => ({
  PageTabs: ({ tabs }: { tabs: Array<{ value: string; label: ReactNode }> }) => (
    <div>{tabs.map((tab) => <button key={tab.value} data-tab={tab.value} type="button">{tab.label}</button>)}</div>
  ),
  Section: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  Step: ({ title, detail, children }: { title: ReactNode; detail?: ReactNode; children?: ReactNode }) => (
    <div><h3>{title}</h3>{detail ? <p>{detail}</p> : null}<div>{children}</div></div>
  ),
  Steps: ({ children }: { children?: ReactNode }) => <ol>{children}</ol>,
}))

vi.mock('~/components/dashboard/ConnectAgent', () => ({
  CodeBlock: ({ label, code }: { label: string; code: string }) => (
    <div><span>{label}</span><pre>{code}</pre></div>
  ),
}))

vi.mock('~/components/ui/tabs', () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('~/components/dashboard/PendingSubmitButton', () => ({
  PendingSubmitButton: ({ children }: { children?: ReactNode }) => <button type="submit">{children}</button>,
}))

vi.mock('~/components/dashboard/SpaConfirmButton', () => ({
  SpaConfirmButton: ({ children, onConfirm }: { children?: ReactNode; onConfirm: () => void }) => (
    <button type="button" onClick={onConfirm}>{children}</button>
  ),
}))

import { SubpathLocationSection } from './SubpathLocationSection'

function subpathLocation(overrides: Partial<SiteLocationView> = {}): SiteLocationView {
  return {
    type: 'subpath',
    url: 'https://customer.example.com/blog',
    status: 'pending',
    proxyTarget: 'https://agent-journal.vibecms.test/_vc/p/PROXYID123',
    snippets: {
      cloudflareWorker: { code: 'export default { fetch() {} }', route: 'customer.example.com/blog*' },
      vercel: '{ "rewrites": [] }',
      nextjs: 'module.exports = {}',
      netlify: '/blog/*  https://agent-journal.vibecms.test/_vc/p/PROXYID123/:splat  200!',
      nginx: 'location /blog {}',
      caddy: '@vcblog path /blog /blog/*',
    },
    ...overrides,
  }
}

function check(overrides: Partial<SiteLocationCheck> = {}): SiteLocationCheck {
  return { ok: true, errors: [], warnings: [], checkedAt: 1_700_000_000, ...overrides }
}

async function render(props: Partial<Parameters<typeof SubpathLocationSection>[0]> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const feedback = vi.fn()
  const refresh = vi.fn(async () => undefined)
  await act(async () => root.render(
    <SubpathLocationSection
      location={null}
      locked={false}
      customDomainActive={false}
      feedback={feedback}
      refresh={refresh}
      {...props}
    />,
  ))
  return { container, root, feedback, refresh }
}


async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

async function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  await act(async () => button?.click())
  await settle()
  return button
}

describe('SubpathLocationSection', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('shows the locked row when the plan does not include it', async () => {
    const { container, root } = await render({ locked: true })
    expect(container.textContent).toContain('part of the paid plan')
    expect(container.textContent).toContain('See plans')
    expect(container.querySelector('#location-url')).toBeNull()
    await act(async () => root.unmount())
    container.remove()
  })

  it('connects a URL through the subpath route', async () => {
    api.setSubpathLocationMutation.mockResolvedValue({ ok: true, location: subpathLocation() })
    const { container, root, feedback, refresh } = await render()
    const input = container.querySelector<HTMLInputElement>('#location-url')!
    expect(input.placeholder).toBe('https://example.com/blog')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://customer.example.com/blog')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()
    expect(api.setSubpathLocationMutation).toHaveBeenCalledWith({ url: 'https://customer.example.com/blog' })
    expect(refresh).toHaveBeenCalled()
    expect(feedback).toHaveBeenCalledWith({ ok: 'location_connected' })
    await act(async () => root.unmount())
    container.remove()
  })

  it('shows API validation errors inline, not as a toast', async () => {
    api.setSubpathLocationMutation.mockResolvedValue({ ok: false, code: 'location_invalid' })
    const { container, root, feedback } = await render()
    const input = container.querySelector<HTMLInputElement>('#location-url')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://customer.example.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await settle()
    const error = container.querySelector('#location-url-error')
    expect(error?.textContent).toContain('https://example.com/blog')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(feedback).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    container.remove()
  })

  it('shows status, snippets per platform and the robots line when connected', async () => {
    const { container, root } = await render({ location: subpathLocation() })
    const text = container.textContent ?? ''
    expect(text).toContain('customer.example.com/blog')
    expect(text).toContain('pending')
    expect(text).toContain('Waiting for the proxy')
    expect(text).toContain('Add the proxy')
    expect(text).toContain('Check setup')
    expect(text).toContain('Tell search engines')
    expect(text).toContain('https://agent-journal.vibecms.test/_vc/p/PROXYID123')
    expect(text).toContain('customer.example.com/blog*')
    expect(text).toContain('Works on the Workers Free plan (100,000 requests a day)')
    expect(text).toContain('Sitemap: https://customer.example.com/blog/sitemap.xml')
    expect(text).toContain('/blog/llms.txt')
    for (const file of ['worker.js', 'vercel.json', 'next.config.js', '_redirects', 'nginx.conf', 'Caddyfile']) {
      expect(text).toContain(file)
    }
    expect(container.querySelector('[aria-label="Copy proxy target"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Copy route"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Copy robots.txt"]')).toBeTruthy()
    await act(async () => root.unmount())
    container.remove()
  })

  it('explains the path is primary when a custom domain is active', async () => {
    const { container, root } = await render({ location: subpathLocation(), customDomainActive: true })
    expect(container.textContent).toContain('primary address')
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders check errors and warnings, then the success state', async () => {
    api.checkSubpathLocationMutation.mockResolvedValue({
      ok: true,
      location: subpathLocation({ status: 'failed' }),
      check: check({
        ok: false,
        errors: [{ code: 'unreachable', message: 'We could not reach the health address through your proxy.' }],
        warnings: [{ code: 'cdn_cache', message: 'Your CDN is caching blog pages.' }],
      }),
    })
    const { container, root } = await render({ location: subpathLocation() })
    await click(container, 'Check setup')
    expect(api.checkSubpathLocationMutation).toHaveBeenCalled()
    expect(container.textContent).toContain('We could not reach the health address through your proxy.')
    expect(container.textContent).toContain('Your CDN is caching blog pages.')
    expect(container.textContent).toContain('Last checked')

    api.checkSubpathLocationMutation.mockResolvedValue({
      ok: true,
      location: subpathLocation({ status: 'active' }),
      check: check({ ok: true }),
    })
    await click(container, 'Check setup')
    expect(container.textContent).toContain('Connected. Your blog is live at customer.example.com/blog.')
    expect(container.querySelector('a[href="https://customer.example.com/blog"]')).toBeTruthy()
    await act(async () => root.unmount())
    container.remove()
  })

  it('rotates the proxy link and disconnects after confirmation', async () => {
    api.rotateSubpathLocationMutation.mockResolvedValue({
      ok: true,
      location: subpathLocation(),
      warning: 'The proxy link changed — the old link stops working at once.',
    })
    api.removeSubpathLocationMutation.mockResolvedValue({ ok: true, location: { type: 'default', url: 'https://agent-journal.vibecms.test', status: 'active' } })
    const { container, root, feedback } = await render({ location: subpathLocation() })
    await click(container, 'New proxy link')
    expect(api.rotateSubpathLocationMutation).toHaveBeenCalled()
    expect(container.textContent).toContain('the old link stops working at once')
    await click(container, 'Disconnect')
    expect(api.removeSubpathLocationMutation).toHaveBeenCalled()
    expect(feedback).toHaveBeenCalledWith({ ok: 'location_removed' })
    await act(async () => root.unmount())
    container.remove()
  })
})
