// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withQueryClient } from '~/test/query'
import type { SeoCheckResult } from '~/types/dashboard'

const api = vi.hoisted(() => ({
  checkPostSeo: vi.fn(async (): Promise<SeoCheckResult> => ({ versionNumber: 1, findings: [] })),
  loadPostAnalytics: vi.fn(async () => null as { views: number; agentReads: number } | null),
}))

vi.mock('~/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  checkPostSeo: api.checkPostSeo,
  loadPostAnalytics: api.loadPostAnalytics,
}))

import { SeoSection, usePostSeoCheck } from './SeoSection'

const finding = (over: Partial<SeoCheckResult['findings'][number]>) => ({
  code: 'x',
  severity: 'warn' as const,
  field: 'content',
  message: 'msg',
  fix: 'fix it',
  ...over,
})

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  vi.clearAllMocks()
  window.localStorage.clear()
})

async function renderSection(props: Partial<Parameters<typeof SeoSection>[0]> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(withQueryClient(
      <SeoSection postId="post-1" postStatus="draft" versionNumber={1} {...props} />,
    ))
  })
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
  // The check is debounced and its response is schema-parsed, so a fixed
  // number of microtask flushes is timing-dependent. With real timers, wait
  // until the check has settled (bounded); fake-timer tests drive time themselves.
  if (!vi.isFakeTimers()) {
    for (let i = 0; i < 200 && (host.textContent ?? '').includes('Checking…'); i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
  return host
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement | null

function type(inputEl: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(inputEl, value)
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SeoSection', () => {
  it('groups findings errors, then warnings, then notes', async () => {
    api.checkPostSeo.mockResolvedValue({
      versionNumber: 1,
      findings: [
        finding({ code: 'link-none-internal', severity: 'info', message: 'Info note' }),
        finding({ code: 'slug-long', severity: 'warn', message: 'Warn item' }),
        finding({ code: 'title-length', severity: 'error', message: 'Error item', field: 'seoTitle' }),
      ],
    })
    const el = await renderSection()
    const text = el.textContent ?? ''
    expect(text).toContain('Errors')
    expect(text).toContain('Warnings')
    expect(text).toContain('Notes')
    expect(text.indexOf('Error item')).toBeLessThan(text.indexOf('Warn item'))
    expect(text.indexOf('Warn item')).toBeLessThan(text.indexOf('Info note'))
  })

  it('runs the check once on mount for the saved version', async () => {
    await renderSection()
    expect(api.checkPostSeo).toHaveBeenCalledTimes(1)
    expect(api.checkPostSeo).toHaveBeenCalledWith({ postId: 'post-1' }, expect.anything())
  })

  it('sends the focus keyword with the check after typing settles', async () => {
    vi.useFakeTimers()
    try {
      await renderSection()
      type(input('post-seo-focus-keyword')!, 'markdown cms')
      await act(async () => { vi.advanceTimersByTime(700) })
      expect(api.checkPostSeo).toHaveBeenCalledWith({ postId: 'post-1', focusKeyword: 'markdown cms' }, expect.anything())
      expect(window.localStorage.getItem('vc-seo-keyword:post-1')).toBe('markdown cms')
    } finally {
      vi.useRealTimers()
    }
  })

  it('focuses the field a finding is attached to when clicked', async () => {
    api.checkPostSeo.mockResolvedValue({
      versionNumber: 1,
      findings: [finding({ code: 'title-length', severity: 'warn', message: 'Title too short', field: 'seoTitle' })],
    })
    const seoTitle = document.createElement('input')
    seoTitle.id = 'post-seo-title'
    document.body.append(seoTitle)
    try {
      const el = await renderSection()
      const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Title too short'))
      expect(button).toBeDefined()
      await act(async () => button!.click())
      expect(document.activeElement).toBe(seoTitle)
    } finally {
      seoTitle.remove()
    }
  })

  it('shows the 30-day line for published posts when analytics is available', async () => {
    api.loadPostAnalytics.mockResolvedValue({ views: 1200, agentReads: 340 })
    const el = await renderSection({ postStatus: 'published' })
    expect(api.loadPostAnalytics).toHaveBeenCalledWith('post-1', expect.anything())
    expect(el.textContent).toMatch(/Last 30 days: 1\.2K views, 340 agent reads/i)
  })

  it('hides the 30-day line for drafts and when analytics is unavailable', async () => {
    api.loadPostAnalytics.mockResolvedValue({ views: 5, agentReads: 2 })
    const draft = await renderSection({ postStatus: 'draft' })
    expect(api.loadPostAnalytics).not.toHaveBeenCalled()
    expect(draft.textContent).not.toContain('Last 30 days')

    act(() => root?.unmount())
    root = null
    draft.remove()

    api.loadPostAnalytics.mockResolvedValue(null)
    const unavailable = await renderSection({ postStatus: 'published' })
    expect(api.loadPostAnalytics).toHaveBeenCalledTimes(1)
    expect(unavailable.textContent).not.toContain('Last 30 days')
  })

  it('stops re-rendering once the debounced SEO inputs settle', async () => {
    vi.useFakeTimers()
    try {
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      let renders = 0
      function Probe() {
        renders += 1
        usePostSeoCheck('post-1', 1, 'markdown cms')
        return null
      }
      await act(async () => {
        root!.render(withQueryClient(<Probe />))
      })
      // One debounce period: the check fires and the params settle.
      await act(async () => { vi.advanceTimersByTime(600) })
      const settled = renders
      // Several more periods must not schedule new timers or renders.
      await act(async () => { vi.advanceTimersByTime(4000) })
      expect(renders).toBe(settled)
      expect(api.checkPostSeo).toHaveBeenCalledTimes(1)
      expect(api.checkPostSeo).toHaveBeenCalledWith({ postId: 'post-1', focusKeyword: 'markdown cms' }, expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })
})
