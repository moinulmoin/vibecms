// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withQueryClient } from '~/test/query'
import { DashboardApiError } from '~/lib/api-client'
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

import { SeoSection } from './SeoSection'

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
      <SeoSection postId="post-1" postStatus="draft" versionNumber={1} onApplySeo={() => {}} {...props} />,
    ))
  })
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
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

  it('shows AI review ideas and fills the SEO fields via Use this', async () => {
    api.checkPostSeo.mockResolvedValue({
      versionNumber: 1,
      findings: [],
      ai: {
        intent: 'informational',
        titleIdeas: ['A better title', 'Another title'],
        descriptionIdea: 'A sharper description.',
        missingSubtopics: ['internal linking'],
        unclearPassages: [{ quote: 'it just works', why: 'no subject' }],
        claimsNeedingSources: [{ quote: '99% faster' }],
      },
    })
    const applied: Array<[string, string]> = []
    const el = await renderSection({ onApplySeo: (field, value) => applied.push([field, value]) })
    const ask = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Ask AI review'))
    await act(async () => ask!.click())
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
    expect(api.checkPostSeo).toHaveBeenCalledWith({ postId: 'post-1', ai: true })
    expect(el.textContent).toContain('A better title')
    expect(el.textContent).toContain('A sharper description.')
    expect(el.textContent).toContain('internal linking')
    expect(el.textContent).toContain('it just works')
    expect(el.textContent).toContain('99% faster')
    const useButtons = [...el.querySelectorAll('button')].filter((b) => b.textContent === 'Use this')
    expect(useButtons).toHaveLength(3)
    await act(async () => useButtons[0]!.click())
    await act(async () => useButtons[2]!.click())
    expect(applied).toEqual([['seoTitle', 'A better title'], ['seoDescription', 'A sharper description.']])
  })

  it('explains the daily limit when AI review is rate limited', async () => {
    api.checkPostSeo
      .mockResolvedValueOnce({ versionNumber: 1, findings: [] })
      .mockRejectedValueOnce(new DashboardApiError(429, 'RATE_LIMIT', 'limited', undefined, 7200))
    const el = await renderSection()
    const ask = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Ask AI review'))
    await act(async () => ask!.click())
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
    expect(el.textContent).toContain("You've used today's AI reviews. Try again in 2 hours.")
  })

  it('explains when AI review is not set up on the server', async () => {
    api.checkPostSeo
      .mockResolvedValueOnce({ versionNumber: 1, findings: [] })
      .mockRejectedValueOnce(new DashboardApiError(503, 'AI_UNAVAILABLE', 'no binding'))
    const el = await renderSection()
    const ask = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Ask AI review'))
    await act(async () => ask!.click())
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
    expect(el.textContent).toContain("AI review isn't set up on this server.")
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
})
