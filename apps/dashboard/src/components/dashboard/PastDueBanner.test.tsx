// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingPageLoadResult, BillingSnapshot } from '~/types/dashboard'

const api = vi.hoisted(() => ({
  loadBillingPage: vi.fn(),
  checkoutBillingMutation: vi.fn(),
  portalBillingMutation: vi.fn(),
}))

vi.mock('~/lib/api-client', () => api)

import { PastDueBanner } from './PastDueBanner'
import { withQueryClient } from '~/test/query'

const DAY_MS = 24 * 60 * 60 * 1000

function hosted(billing: Partial<BillingSnapshot>, isOwner = true): BillingPageLoadResult {
  return {
    selfHosted: false,
    isOwner,
    billing: { status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: null, polarCustomerId: null, pastDueSince: null, graceEndsAt: null, ...billing },
    managed: null,
  }
}

function pastDue(graceEndsAt: number, isOwner = true) {
  return hosted({ status: 'past_due', pastDueSince: graceEndsAt - 7 * DAY_MS, graceEndsAt }, isOwner)
}

let mounted: { root: Root; container: HTMLElement } | null = null

async function render(data: BillingPageLoadResult) {
  api.loadBillingPage.mockResolvedValue(data)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => root.render(withQueryClient(<PastDueBanner />)))
  await act(async () => {
    // Fake-clock tests flush the query on the virtual clock; the rest yield one real tick.
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0)
      return
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
  const findButton = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))
  return { container, findButton }
}

describe('PastDueBanner', () => {
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

  it('names the grace deadline and opens the portal for owners', async () => {
    api.portalBillingMutation.mockResolvedValue({ kind: 'ok', url: 'https://polar.example/portal' })
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location)
    const graceEndsAt = Date.UTC(2026, 9, 22, 12)
    vi.spyOn(Date, 'now').mockReturnValue(graceEndsAt - 2 * DAY_MS)
    const { container, findButton } = await render(pastDue(graceEndsAt))

    expect(container.textContent).toContain('Your last payment failed. Paid features stay on until October 22, 2026.')
    const update = findButton('Update payment')
    expect(update).toBeDefined()
    await act(async () => update?.click())
    expect(api.portalBillingMutation).toHaveBeenCalledTimes(1)
    expect(api.checkoutBillingMutation).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('https://polar.example/portal')
  })

  it('keeps the update action usable after a portal error', async () => {
    api.portalBillingMutation.mockResolvedValue({ kind: 'error', code: 'polar_unconfigured' })
    const { findButton } = await render(pastDue(Date.now() - DAY_MS))

    await act(async () => findButton('Update payment')?.click())
    expect(api.portalBillingMutation).toHaveBeenCalledTimes(1)
    expect(findButton('Update payment')?.disabled).toBe(false)
  })

  it('says paid features are paused once the grace window has passed', async () => {
    const { container, findButton } = await render(pastDue(Date.now() - DAY_MS))

    expect(container.textContent).toContain('Your last payment failed. Paid features are paused.')
    expect(findButton('Update payment')).toBeDefined()
  })

  it('switches to paused when the deadline passes while the page stays open', async () => {
    const graceEndsAt = Date.UTC(2026, 9, 22, 12)
    vi.useFakeTimers({ now: graceEndsAt - 1000 })
    const { container } = await render(pastDue(graceEndsAt))
    expect(container.textContent).toContain('Paid features stay on until October 22, 2026.')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(container.textContent).toContain('Paid features stay on until')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container.textContent).toContain('Paid features are paused.')
    expect(api.loadBillingPage).toHaveBeenCalledTimes(1)
  })

  it('still pauses on time when the deadline is beyond one timer delay', async () => {
    const graceEndsAt = Date.UTC(2026, 9, 22, 12)
    const lead = 30 * DAY_MS // longer than setTimeout's 2^31-1 ms ceiling
    vi.useFakeTimers({ now: graceEndsAt - lead })
    const { container } = await render(pastDue(graceEndsAt))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(lead - 1)
    })
    expect(container.textContent).toContain('Paid features stay on until')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container.textContent).toContain('Paid features are paused.')
  })

  it('tells non-owners to ask the owner instead of offering a portal they cannot open', async () => {
    const { container, findButton } = await render(pastDue(Date.now() + DAY_MS, false))

    expect(container.textContent).toContain('Ask the workspace owner to update the payment method.')
    expect(findButton('Update payment')).toBeUndefined()
  })

  it('stays hidden for active, recovered, and self-hosted workspaces', async () => {
    const { container } = await render(hosted({ status: 'active' }))
    expect(container.textContent).toBe('')
    await act(async () => mounted?.root.unmount())
    mounted?.container.remove()
    mounted = null

    const selfHosted = await render({
      selfHosted: true,
      isOwner: true,
      billing: { status: 'past_due', currentPeriodEnd: null, cancelAtPeriodEnd: null, pastDueSince: null, graceEndsAt: null },
    })
    expect(selfHosted.container.textContent).toBe('')
  })
})
