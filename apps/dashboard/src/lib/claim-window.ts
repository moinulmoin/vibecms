import { useEffect, useState } from 'react'
import { formatBillingDate } from '~/lib/billing-grace'

/**
 * The claim window ("keep your blog") for a revoked AutoSEOPilot sponsorship.
 * Day 0 is the managed revoke: the blog stays online until `pausedAt`, then
 * serves the paused page, and an unclaimed blog is deleted at `deadline`.
 * Epoch seconds, like the rest of the managed payload.
 */
export type ClaimWindow = {
  revokedAt: number
  pausedAt: number
  deadline: number
}

export type ClaimWindowState = 'grace' | 'paused' | 'expired'

/** setTimeout clamps larger delays to ~0ms, so long waits re-arm in capped steps. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1

/** Which part of the window we are in: still online, paused, or past the deadline. */
export function claimWindowState(claim: ClaimWindow | null, nowMs = Date.now()): ClaimWindowState | null {
  if (!claim) return null
  if (nowMs >= claim.deadline * 1000) return 'expired'
  if (nowMs >= claim.pausedAt * 1000) return 'paused'
  return 'grace'
}

/** The window state that flips on its own (at the pause and at the deadline) without a refetch. */
export function useClaimWindowState(claim: ClaimWindow | null): ClaimWindowState | null {
  const [tick, setTick] = useState(0)
  const state = claimWindowState(claim)
  useEffect(() => {
    if (!claim) return
    const nowMs = Date.now()
    const nextAt = nowMs < claim.pausedAt * 1000 ? claim.pausedAt * 1000 : claim.deadline * 1000
    if (nextAt <= nowMs) return
    const timer = window.setTimeout(() => setTick((value) => value + 1), Math.min(nextAt - nowMs, MAX_TIMER_DELAY_MS))
    return () => window.clearTimeout(timer)
  }, [claim?.pausedAt, claim?.deadline, tick])
  return state
}

/** The one sentence the dashboard uses to explain the claim window. */
export function claimMessage(claim: ClaimWindow, state: ClaimWindowState, blogName = 'This blog'): string {
  const deadline = formatBillingDate(claim.deadline * 1000)
  if (state === 'expired') {
    return `Your AutoSEOPilot plan ended. The deadline to keep ${blogName.toLowerCase()} passed on ${deadline}.`
  }
  const keep = `Keep the same posts, media and domain by upgrading to vibecms Cloud before ${deadline}; after that the blog is deleted.`
  if (state === 'paused') {
    return `Your AutoSEOPilot plan ended and ${blogName.toLowerCase()} is paused. ${keep}`
  }
  return `Your AutoSEOPilot plan ended. ${blogName} stays online until ${formatBillingDate(claim.pausedAt * 1000)}. ${keep}`
}
