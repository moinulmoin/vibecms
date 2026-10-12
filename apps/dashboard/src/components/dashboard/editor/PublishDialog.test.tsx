// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { SeoFinding } from '~/types/dashboard'
import { PublishDialog, quickPicks, timezoneLabel } from './PublishDialog'

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const pad = (n: number) => String(n).padStart(2, '0')

async function renderDialog(onSchedule = vi.fn(), onConfirm = vi.fn(), extra: { seoFindings?: SeoFinding[]; onReviewSeo?: () => void } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<PublishDialog open onOpenChange={() => {}} versionNumber={3}
    liveVersionNumber={null} liveUrl={null} warnings={[]} seoFindings={extra.seoFindings} onReviewSeo={extra.onReviewSeo} pending={false} error={null}
    onConfirm={onConfirm} onSchedule={onSchedule} />))
  return { onSchedule, onConfirm, cleanup: async () => { await act(async () => root.unmount()); host.remove() } }
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))

describe('PublishDialog', () => {
  it('publishes now by default', async () => {
    const view = await renderDialog()
    await act(async () => button('Publish v3 now')?.click())
    expect(view.onConfirm).toHaveBeenCalled()
    await view.cleanup()
  })

  it('schedules a local date and time as UTC epoch seconds and says when in plain words', async () => {
    const view = await renderDialog()
    await act(async () => document.querySelector<HTMLButtonElement>('button[role="radio"][value="schedule"]')?.click())
    expect(document.body.textContent).toContain(timezoneLabel())
    const local = new Date(Date.now() + 2 * 86_400_000)
    local.setHours(14, 30, 0, 0)
    await act(async () => {
      setValue(document.querySelector<HTMLInputElement>('input[type="date"]')!, `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`)
      setValue(document.querySelector<HTMLInputElement>('input[type="time"]')!, '14:30')
    })
    expect(document.body.textContent).toContain('Goes live')
    await act(async () => button('Schedule v3')?.click())
    expect(view.onSchedule).toHaveBeenCalledWith(Math.floor(local.getTime() / 1000))
    await view.cleanup()
  })

  it('offers quick picks in the future and names the timezone like a person would', () => {
    const now = new Date(2026, 9, 1, 15, 7)
    const picks = quickPicks(now)
    expect(picks.map((p) => p.label)).toEqual(['In an hour', 'Tomorrow, 9:00', 'Monday, 9:00'])
    for (const pick of picks) expect(pick.at.getTime()).toBeGreaterThan(now.getTime())
    expect(picks[0]!.at.getMinutes() % 15).toBe(0)
    expect(picks[2]!.at.getDay()).toBe(1)
    expect(timezoneLabel('Asia/Nicosia')).toBe('Nicosia time')
    expect(timezoneLabel('America/New_York')).toBe('New York time')
  })

  it('lists only error-severity SEO findings and offers a way back to the rail', async () => {
    const onReviewSeo = vi.fn()
    const view = await renderDialog(vi.fn(), vi.fn(), {
      onReviewSeo,
      seoFindings: [
        { code: 'link-internal-broken', severity: 'error', field: 'content', message: 'Broken internal link', fix: 'fix' },
        { code: 'title-length', severity: 'warn', field: 'seoTitle', message: 'Title too short', fix: 'fix' },
        { code: 'site-not-indexable', severity: 'info', field: 'site', message: 'Site not indexable', fix: 'fix' },
      ],
    })
    expect(document.body.textContent).toContain('SEO issue to fix')
    expect(document.body.textContent).toContain('Broken internal link')
    expect(document.body.textContent).not.toContain('Title too short')
    expect(document.body.textContent).not.toContain('Site not indexable')
    await act(async () => button('Review')?.click())
    expect(onReviewSeo).toHaveBeenCalled()
    await view.cleanup()
  })

  it('shows no SEO block when there are no error findings', async () => {
    const view = await renderDialog(vi.fn(), vi.fn(), {
      seoFindings: [{ code: 'title-length', severity: 'warn', field: 'seoTitle', message: 'Title too short', fix: 'fix' }],
    })
    expect(document.body.textContent).not.toContain('SEO issue')
    await view.cleanup()
  })

  it('caps a long SEO findings list and keeps publish controls reachable', async () => {
    const onReviewSeo = vi.fn()
    const view = await renderDialog(vi.fn(), vi.fn(), {
      onReviewSeo,
      seoFindings: Array.from({ length: 30 }, (_, index) => ({
        code: 'link-internal-broken',
        severity: 'error' as const,
        field: 'content',
        message: `Broken link ${index + 1}`,
        fix: 'fix',
      })),
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('SEO issues to fix')
    expect(text).toContain('Broken link 1')
    expect(text).toContain('Broken link 5')
    expect(text).not.toContain('Broken link 6')
    expect(text).not.toContain('Broken link 30')
    expect(text).toContain('and 25 more')
    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content?.className).toContain('overflow-y-auto')
    expect(content?.className).toContain('max-h-')
    await act(async () => button('Review all in the SEO section')?.click())
    expect(onReviewSeo).toHaveBeenCalled()
    await act(async () => button('Publish v3 now')?.click())
    expect(view.onConfirm).toHaveBeenCalled()
    expect(button('Not yet')).toBeTruthy()
    await view.cleanup()
  })
})
