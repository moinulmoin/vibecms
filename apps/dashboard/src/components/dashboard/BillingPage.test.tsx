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

vi.mock('~/components/dashboard/DashboardLayout', () => ({
  LoadError: ({ message }: { message: string }) => <p>{message}</p>,
}))

import { PlanAndBilling } from './BillingPage'
import { withQueryClient } from '~/test/query'

// Noon UTC keeps the rendered calendar date stable across test-runner time zones.
const PERIOD_END = Date.UTC(2026, 10, 15, 12) / 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_SECONDS = 24 * 60 * 60

/** Header of the plan column the table highlights as the one in effect. */
function boldColumn(container: HTMLElement) {
  const headers = [...container.querySelectorAll('thead th')]
  return headers.find((header) => header.className.includes('font-medium'))?.textContent?.trim()
}

type Managed = Extract<BillingPageLoadResult, { selfHosted: false }>['managed']
type Claim = Extract<BillingPageLoadResult, { selfHosted: false }>['claim']

function hosted(
  billing: Partial<BillingSnapshot>,
  overrides: { isOwner?: boolean; managed?: Managed; claim?: Claim } = {},
): BillingPageLoadResult {
  return {
    selfHosted: false,
    isOwner: overrides.isOwner ?? true,
    billing: { status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: null, polarCustomerId: null, pastDueSince: null, graceEndsAt: null, ...billing },
    managed: overrides.managed ?? null,
    claim: overrides.claim ?? null,
  }
}

let mounted: { root: Root; container: HTMLElement } | null = null

async function render(data: BillingPageLoadResult) {
  api.loadBillingPage.mockResolvedValue(data)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => root.render(withQueryClient(<PlanAndBilling />)))
  await act(async () => {
    // Fake-clock tests flush the query on the virtual clock; the rest yield one real tick.
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0)
      return
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })
  const findButton = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))
  const requireButton = (text: string) => {
    const button = findButton(text)
    if (!button) throw new Error(`Expected a "${text}" button`)
    return button
  }
  return { container, findButton, requireButton }
}

describe('PlanAndBilling', () => {
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

  it('keeps paid features during the grace window and recovers through the portal, never a new checkout', async () => {
    api.portalBillingMutation.mockResolvedValue({ kind: 'error', code: 'polar_unconfigured' })
    const graceEndsAt = Date.UTC(2026, 9, 22, 12)
    vi.spyOn(Date, 'now').mockReturnValue(graceEndsAt - DAY_MS)
    const { container, findButton, requireButton } = await render(
      hosted({ status: 'past_due', currentPeriodEnd: PERIOD_END, polarCustomerId: 'cus_1', pastDueSince: graceEndsAt - 7 * DAY_MS, graceEndsAt }),
    )

    expect(container.textContent).toContain('Paid plan')
    expect(container.textContent).toContain('Paid features stay on until October 22, 2026.')
    expect(boldColumn(container)).toMatch(/^Paid/)
    expect(findButton('Upgrade')).toBeUndefined()
    expect(findButton('Yearly')).toBeUndefined()
    expect(findButton('Invoices and payment details')).toBeUndefined()

    const update = requireButton('Update payment')
    await act(async () => update.click())
    expect(api.portalBillingMutation).toHaveBeenCalledTimes(1)
    expect(api.checkoutBillingMutation).not.toHaveBeenCalled()
    // The portal failure surfaces as a toast; the button is usable again.
    expect(requireButton('Update payment').disabled).toBe(false)
  })

  it('shows paid features paused after the grace window, still offering only the portal', async () => {
    const graceEndsAt = Date.now() - DAY_MS
    const { container, findButton, requireButton } = await render(
      hosted({ status: 'past_due', pastDueSince: graceEndsAt - 7 * DAY_MS, graceEndsAt }),
    )

    expect(container.textContent).toContain('Your last payment failed. Paid features are paused.')
    expect(boldColumn(container)).toBe('Free')
    requireButton('Update payment')
    expect(findButton('Upgrade')).toBeUndefined()
  })

  it('pauses paid features when the grace window ends while the page stays open', async () => {
    const graceEndsAt = Date.UTC(2026, 9, 22, 12)
    vi.useFakeTimers({ now: graceEndsAt - 1000 })
    const { container } = await render(hosted({ status: 'past_due', pastDueSince: graceEndsAt - 7 * DAY_MS, graceEndsAt }))

    expect(container.textContent).toContain('Paid features stay on until October 22, 2026.')
    expect(boldColumn(container)).toMatch(/^Paid/)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(boldColumn(container)).toMatch(/^Paid/)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(container.textContent).toContain('Paid features are paused.')
    expect(boldColumn(container)).toBe('Free')
    expect(api.loadBillingPage).toHaveBeenCalledTimes(1)
  })

  it('restores the active plan once payment recovers', async () => {
    const { container, findButton, requireButton } = await render(
      hosted({ status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false }),
    )

    expect(container.textContent).not.toContain('Your last payment failed')
    expect(boldColumn(container)).toMatch(/^Paid/)
    expect(findButton('Update payment')).toBeUndefined()
    requireButton('Manage subscription')
  })

  it('recovers past due through the portal when a sponsorship has ended', async () => {
    const { findButton, requireButton } = await render(
      hosted({ status: 'past_due' }, { managed: { status: 'revoked', expiresAt: null, effective: false } }),
    )

    requireButton('Update payment')
    expect(findButton('Upgrade')).toBeUndefined()
    expect(findButton('Yearly')).toBeUndefined()
  })

  it('explains the claim window instead of promising the posts stay online', async () => {
    const revokedAt = Date.UTC(2026, 9, 1, 12) / 1000
    vi.spyOn(Date, 'now').mockReturnValue(revokedAt * 1000 + 2 * DAY_MS)
    const { container, requireButton } = await render(
      hosted({}, {
        managed: { status: 'revoked', expiresAt: null, effective: false },
        claim: { revokedAt, pausedAt: revokedAt + 7 * DAY_SECONDS, deadline: revokedAt + 30 * DAY_SECONDS },
      }),
    )

    expect(container.textContent).toContain('Your AutoSEOPilot plan ended.')
    expect(container.textContent).toContain('stays online until October 8, 2026')
    expect(container.textContent).toContain('before October 31, 2026')
    expect(container.textContent).not.toContain('Your posts stay online')
    requireButton('Upgrade')
  })

  it('says the blog is paused once the claim grace has passed', async () => {
    const revokedAt = Date.UTC(2026, 9, 1, 12) / 1000
    vi.spyOn(Date, 'now').mockReturnValue(revokedAt * 1000 + 10 * DAY_MS)
    const { container } = await render(
      hosted({}, {
        managed: { status: 'revoked', expiresAt: null, effective: false },
        claim: { revokedAt, pausedAt: revokedAt + 7 * DAY_SECONDS, deadline: revokedAt + 30 * DAY_SECONDS },
      }),
    )

    expect(container.textContent).toContain('is paused')
    expect(container.textContent).toContain('before October 31, 2026')
  })

  it('keeps payment recovery available while sponsorship still grants paid features', async () => {
    const { container, findButton, requireButton } = await render(
      hosted({ status: 'past_due' }, { managed: { status: 'active', expiresAt: null, effective: true } }),
    )

    expect(container.textContent).toContain('Paid plan')
    expect(container.textContent).not.toContain('Paid features are paused.')
    expect(boldColumn(container)).toMatch(/^Paid/)
    requireButton('Update payment')
    expect(findButton('Upgrade')).toBeUndefined()
    expect(findButton('Yearly')).toBeUndefined()
  })

  it('tells non-owners to ask the owner when payment is past due', async () => {
    const { container, findButton } = await render(hosted({ status: 'past_due' }, { isOwner: false }))

    expect(container.textContent).toContain('Ask the workspace owner to update the payment method.')
    expect(findButton('Update payment')).toBeUndefined()
    expect(findButton('Upgrade')).toBeUndefined()
  })

  it('opens checkout for a workspace without a subscription', async () => {
    api.checkoutBillingMutation.mockResolvedValue({ kind: 'error', code: 'checkout_failed' })
    const { findButton, requireButton } = await render(hosted({ status: 'none' }))

    expect(findButton('Update payment')).toBeUndefined()
    const upgrade = requireButton('Upgrade')
    await act(async () => upgrade.click())
    expect(api.checkoutBillingMutation).toHaveBeenCalledWith({ interval: 'monthly' })
    expect(api.portalBillingMutation).not.toHaveBeenCalled()
  })

  it('labels the period end as Ends once cancellation is scheduled, keeping portal management', async () => {
    api.portalBillingMutation.mockResolvedValue({ kind: 'error', code: 'polar_unconfigured' })
    const { container, findButton, requireButton } = await render(
      hosted({ status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: true }),
    )

    expect(container.textContent).toContain('Ends November 15, 2026')
    expect(container.textContent).not.toContain('Renews')
    expect(findButton('Upgrade')).toBeUndefined()
    const manage = requireButton('Manage subscription')
    await act(async () => manage.click())
    expect(api.portalBillingMutation).toHaveBeenCalledTimes(1)
  })

  it('labels the period end as Renews without a scheduled cancellation', async () => {
    const { container } = await render(hosted({ status: 'active', currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false }))

    expect(container.textContent).toContain('Renews November 15, 2026')
    expect(container.textContent).not.toContain('Ends')
  })
})
