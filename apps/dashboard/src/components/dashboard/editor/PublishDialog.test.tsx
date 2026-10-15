// @vitest-environment happy-dom
import { act, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { SeoFinding } from '~/types/dashboard'
import { PublishDialog, quickPicks, timezoneLabel, type PublishDialogProps } from './PublishDialog'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search }: { children?: ReactNode; to?: string; search?: unknown }) =>
    <a href={to} data-search={JSON.stringify(search)}>{children}</a>,
}))

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
const title = () => document.querySelector('[data-slot="dialog-title"]')?.textContent ?? null
const flushFocus = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
/** Footer actions in DOM order: dismiss, then confirm. */
const footerButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button')]

const BASE: Omit<PublishDialogProps, 'open' | 'onOpenChange'> = {
  versionNumber: 3, liveVersionNumber: null, liveUrl: null, warnings: [], pending: false, error: null,
  onConfirm: () => {}, onSchedule: () => {},
}

/** Owns `open` like the editor shell does, with a real button that opens it. */
function Harness(props: Partial<PublishDialogProps> & { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open publish</button>
      <PublishDialog {...BASE} {...props} open={open} onOpenChange={(next) => { props.onOpenChange?.(next); setOpen(next) }} />
    </>
  )
}

async function renderHarness(props: Partial<PublishDialogProps> & { onOpenChange?: (open: boolean) => void } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness {...props} />))
  const trigger = button('Open publish')!
  const open = async () => {
    trigger.focus()
    await act(async () => trigger.click())
  }
  return { trigger, open, cleanup: async () => { await act(async () => root.unmount()); host.remove() } }
}

const pressEscape = () => act(async () => {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})

describe('PublishDialog', () => {
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

  it('puts every quick pick in the future: next quarter hour, then Monday', () => {
    const now = new Date(2026, 9, 1, 15, 7)
    const picks = quickPicks(now)
    for (const pick of picks) expect(pick.at.getTime()).toBeGreaterThan(now.getTime())
    expect(picks[0]!.at.getMinutes() % 15).toBe(0)
    expect(picks[2]!.at.getDay()).toBe(1)
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
    await view.cleanup()
  })

  it('starts every opening from Now, even after scheduling was picked and the dialog cancelled', async () => {
    const view = await renderHarness()
    await view.open()
    await act(async () => document.querySelector<HTMLButtonElement>('button[role="radio"][value="schedule"]')?.click())
    expect(title()).toBe('Schedule v3')
    expect(button('Schedule v3')).toBeTruthy()
    await act(async () => footerButtons()[0]?.click())
    await flushFocus()
    expect(title()).toBeNull()

    await view.open()
    expect(title()).toBe('Publish v3')
    expect(document.querySelector('button[role="radio"][value="now"]')?.getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('input[type="date"]')).toBeNull()
    expect(button('Publish v3 now')).toBeTruthy()
    await view.cleanup()
  })

  it('returns focus to the button that opened it after Escape and after Cancel', async () => {
    const view = await renderHarness()
    await view.open()
    expect(document.activeElement).not.toBe(view.trigger)
    await pressEscape()
    await flushFocus()
    expect(document.activeElement).toBe(view.trigger)

    await view.open()
    await act(async () => footerButtons()[0]?.click())
    await flushFocus()
    expect(document.activeElement).toBe(view.trigger)
    await view.cleanup()
  })

  it('returns focus to an explicit element when the shell provides one', async () => {
    const target = document.createElement('button')
    target.textContent = 'Header publish'
    document.body.appendChild(target)
    const view = await renderHarness({ returnFocusRef: { current: target } })
    await view.open()
    await pressEscape()
    await flushFocus()
    expect(document.activeElement).toBe(target)
    await view.cleanup()
    target.remove()
  })

  it('cannot be dismissed while publishing is pending', async () => {
    const onOpenChange = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<PublishDialog {...BASE} open pending onOpenChange={onOpenChange} />))
    await pressEscape()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(footerButtons().length).toBeGreaterThan(0)
    expect(footerButtons().every((b) => b.disabled)).toBe(true)
    await act(async () => root.unmount())
    host.remove()
  })

  it.each(['billing_required', 'draft_limit', 'media_quota_free'])('links a %s plan cap error straight to billing', async (errorCode) => {
    const view = await renderHarness({ error: 'Plan limit reached.', errorCode })
    await view.open()
    const plans = document.querySelector<HTMLAnchorElement>('[role="alert"] a')
    expect(plans?.getAttribute('href')).toBe('/dashboard/settings')
    expect(JSON.parse(plans?.dataset.search ?? '{}')).toEqual({ tab: 'billing' })
    await view.cleanup()
  })

  it('offers no billing link for other publish errors', async () => {
    const view = await renderHarness({ error: 'Could not publish right now.', errorCode: 'slug_conflict' })
    await view.open()
    expect(document.querySelector('[role="alert"]')).toBeTruthy()
    expect(document.querySelector('[role="alert"] a')).toBeNull()
    await view.cleanup()
  })

  it('links a site-not-indexable finding to the billing tab', async () => {
    const view = await renderHarness({
      seoFindings: [{ code: 'site-not-indexable', severity: 'info', field: 'site', message: 'Site is not indexable', fix: 'fix' }],
    })
    await view.open()
    const billing = [...document.querySelectorAll<HTMLAnchorElement>('[data-slot="dialog-content"] a')]
      .find((a) => JSON.parse(a.dataset.search ?? '{}').tab === 'billing')
    expect(billing?.getAttribute('href')).toBe('/dashboard/settings')
    await view.cleanup()
  })
})
