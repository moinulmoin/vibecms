import { useEffect, useState } from 'react'
import { formatBillingDate } from '~/lib/billing-grace'
import type { ServingState } from '~/types/dashboard'

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

/** What visitors see right now: `grace` flips to `paused` at `pausedAt`. */
export function servingState(serving: ServingState | null, nowMs = Date.now()): ServingState['state'] | null {
  if (!serving) return null
  if (serving.state === 'grace' && serving.pausedAt !== null && nowMs >= serving.pausedAt * 1000) return 'paused'
  return serving.state
}

/** The serving state that flips from grace to paused on its own, without a refetch. */
export function useServingState(serving: ServingState | null): ServingState['state'] | null {
  const [tick, setTick] = useState(0)
  const state = servingState(serving)
  useEffect(() => {
    if (!serving || serving.state !== 'grace' || serving.pausedAt === null) return
    const nowMs = Date.now()
    const nextAt = serving.pausedAt * 1000
    if (nextAt <= nowMs) return
    const timer = window.setTimeout(() => setTick((value) => value + 1), Math.min(nextAt - nowMs, MAX_TIMER_DELAY_MS))
    return () => window.clearTimeout(timer)
  }, [serving?.state, serving?.pausedAt, tick])
  return state
}

/**
 * The sentence for a blog that has no claim window (it was claimed, so it is
 * never deleted) but whose subscription ended: it is paused, or pauses at
 * `pausedAt`. Never a deletion deadline. Null while the blog is online.
 */
export function servingMessage(
  serving: ServingState,
  state: ServingState['state'],
  blogName = 'This blog',
): string | null {
  if (state === 'paused') {
    const name = blogName === 'This blog' ? 'this blog' : blogName
    return `Your subscription ended, so ${name} is paused for visitors. Nothing was deleted: subscribe again to bring it back online.`
  }
  if (state === 'grace' && serving.pausedAt !== null) {
    return `Your subscription ended. ${blogName} stays online until ${formatBillingDate(serving.pausedAt * 1000)}, then pauses for visitors. Nothing will be deleted: subscribe again to keep it online.`
  }
  return null
}
