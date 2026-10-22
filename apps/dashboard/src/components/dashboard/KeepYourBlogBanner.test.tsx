// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { BillingPageLoadResult } from '~/types/dashboard'

const api = vi.hoisted(() => ({
  loadBillingPage: vi.fn(),
  checkoutBillingMutation: vi.fn(),
  portalBillingMutation: vi.fn(),
}))

vi.mock('~/lib/api-client', () => api)

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search }: { children?: ReactNode; to: string; search?: { tab?: string } }) => (
    <a href={`${to}?tab=${search?.tab ?? ''}`}>{children}</a>
  ),
}))

import { KeepYourBlogBanner } from './KeepYourBlogBanner'
import { withQueryClient } from '~/test/query'

const DAY_MS = 24 * 60 * 60 * 1000
const DAY_SECONDS = 24 * 60 * 60
const REVOKED_AT = Date.UTC(2026, 9, 1, 12) / 1000

function revokedClaim() {
  return {
    revokedAt: REVOKED_AT,
    pausedAt: REVOKED_AT + 7 * DAY_SECONDS,
    deadline: REVOKED_AT + 30 * DAY_SECONDS,
  }
}

function revoked(isOwner = true): Extract<BillingPageLoadResult, { selfHosted: false }> {
  return {
    selfHosted: false,
    isOwner,
    billing: { status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: null, polarCustomerId: null, pastDueSince: null, graceEndsAt: null },
    managed: { status: 'revoked', expiresAt: null, effective: false },
    claim: revokedClaim(),
    serving: { state: 'grace', pausedAt: REVOKED_AT + 7 * DAY_SECONDS },
  }
}

let mounted: { root: Root; container: HTMLElement } | null = null

async function render(data: BillingPageLoadResult) {
  api.loadBillingPage.mockResolvedValue(data)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => root.render(withQueryClient(<KeepYourBlogBanner siteName="Agent Journal" />)))
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0)
      return
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
  return { container }
}

describe('KeepYourBlogBanner', () => {
  afterEach(async () => {
    if (mounted) {
      const { root, container } = mounted
      await act(async () => root.unmount())
      container.remove()
      mounted = null
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('names the blog, the deadline and the way to keep it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REVOKED_AT * 1000 + 2 * DAY_MS)
    const { container } = await render(revoked())

    expect(container.textContent).toContain('Your AutoSEOPilot plan ended.')
    expect(container.textContent).toContain('Agent Journal')
    expect(container.textContent).toContain('stays online until October 8, 2026')
    expect(container.textContent).toContain('before October 31, 2026')
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/dashboard/settings?tab=billing')
    expect(link?.textContent).toContain('Keep my blog')
  })

  it('says the blog is paused once the claim grace has passed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REVOKED_AT * 1000 + 10 * DAY_MS)
    const { container } = await render(revoked())

    expect(container.textContent).toContain('is paused')
    expect(container.textContent).toContain('before October 31, 2026')
  })

  it('tells non-owners to ask the owner instead of linking to a plan they cannot buy', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REVOKED_AT * 1000 + 2 * DAY_MS)
    const { container } = await render(revoked(false))

    expect(container.textContent).toContain('Ask the workspace owner to upgrade and keep this blog.')
    expect(container.querySelector('a')).toBeNull()
  })

  it('stays hidden once the blog is claimed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(REVOKED_AT * 1000 + 2 * DAY_MS)
    const claimed = revoked()
    const { container } = await render({ ...claimed, claim: null, serving: { state: 'online', pausedAt: null } })

    expect(container.textContent).toBe('')
  })
})
