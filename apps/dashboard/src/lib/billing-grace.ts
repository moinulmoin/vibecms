import { useEffect, useState } from 'react'
import type { BillingPageLoadResult } from '~/types/dashboard'

/** A failed renewal: paid features run until `endsAt` (epoch ms), then pause. */
export type PastDueState = { kind: 'grace'; endsAt: number } | { kind: 'paused' }

/** setTimeout clamps larger delays to ~0ms, so long waits re-arm in capped steps. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** The server's `graceEndsAt` is the only deadline; a missing one means paid features are already paused. */
export function pastDueState(data: BillingPageLoadResult | undefined, nowMs: number): PastDueState | null {
  if (!data || data.selfHosted || data.billing.status !== 'past_due') return null
  const endsAt = data.billing.graceEndsAt
  return endsAt !== null && nowMs < endsAt ? { kind: 'grace', endsAt } : { kind: 'paused' }
}

/** Long calendar date shared by every billing deadline ("November 15, 2026"). */
export function formatBillingDate(epochMs: number) {
  return new Date(epochMs).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })
}

/** Sponsorship keeps paid features on after the grace ends, so "paused" would be untrue there. */
export function pastDueMessage(state: PastDueState, sponsored = false) {
  if (state.kind === 'grace') return `Your last payment failed. Paid features stay on until ${formatBillingDate(state.endsAt)}.`
  return sponsored
    ? 'Your last payment failed. AutoSEOPilot still covers this blog, so everything stays unlocked.'
    : 'Your last payment failed. Paid features are paused.'
}

/** Portal access is owner-only on the server; everyone else gets a plain instruction instead of a dead button. */
export const OWNER_PAYMENT_NOTE = 'Ask the workspace owner to update the payment method.'

/** Past-due state that flips from grace to paused when the deadline passes, without a refetch. */
export function usePastDueState(data: BillingPageLoadResult | undefined): PastDueState | null {
  // Re-render tick: one timer at a time, re-armed after each capped wait.
  const [tick, setTick] = useState(0)
  const state = pastDueState(data, Date.now())
  const endsAt = state?.kind === 'grace' ? state.endsAt : null

  useEffect(() => {
    if (endsAt === null) return
    const delay = Math.min(Math.max(endsAt - Date.now(), 0), MAX_TIMER_DELAY_MS)
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay)
    return () => window.clearTimeout(timer)
  }, [endsAt, tick])

  return state
}
