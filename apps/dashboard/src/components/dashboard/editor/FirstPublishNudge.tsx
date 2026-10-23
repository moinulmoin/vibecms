import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@vc/ui'
import { ExternalLink, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { contextQuery, overviewQuery } from '~/lib/queries'
import { pinnedDashboardSiteId } from '~/lib/site-pin'
import type { AppRouterContext } from '~/types/dashboard'

/**
 * One-time note after a site's first human publish on the hosted free plan:
 * free blogs carry `noindex`, so point at Settings → Billing once, calmly.
 *
 * Flow: on mount the hook prefetches eligibility from a fresh overview read
 * (true entitlement + no live post yet), off the approval path. `prepare()`
 * before the publish dialog opens synchronously snapshots that prefetched
 * answer, returning null while it is unresolved, failed, or already shown;
 * `confirm(ticket)` after the publish is confirmed live shows the note. Shown
 * once per site, ever.
 */
export type FirstPublishTicket = { siteId: string } | null

export type FirstPublishNudgeState = {
  /** Call before publishing. Synchronous, never throws; null when eligibility is not loaded or the nudge must not show. */
  prepare: () => FirstPublishTicket
  /** Call only after the publish is confirmed live, with the ticket from `prepare`. */
  confirm: (ticket: FirstPublishTicket) => void
  visible: boolean
  dismiss: () => void
}

const STORAGE_PREFIX = 'vc-first-publish-nudge:'
// Storage can be unavailable (private mode); still never repeat within this tab.
const seenThisTab = new Set<string>()

function hasSeen(siteId: string) {
  if (seenThisTab.has(siteId)) return true
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + siteId) !== null
  } catch {
    return false
  }
}

function markSeen(siteId: string) {
  seenThisTab.add(siteId)
  try {
    window.localStorage.setItem(STORAGE_PREFIX + siteId, '1')
  } catch {
    // Optional persistence; the in-tab set still prevents a repeat.
  }
}

/** Hosted free plan, and nothing has ever gone live on the site. */
export function isFirstFreePublish(data: { billing: { access?: string }; counts: { published: number }; activationPost: unknown }) {
  return data.billing.access === 'hosted_free' && data.counts.published === 0 && data.activationPost === null
}

export function useFirstPublishNudge(): FirstPublishNudgeState {
  const client = useQueryClient()
  const [shownFor, setShownFor] = useState<string | null>(null)
  const readyTicket = useRef<FirstPublishTicket>(null)

  useEffect(() => {
    readyTicket.current = null
    const siteId = pinnedDashboardSiteId() ?? client.getQueryData<AppRouterContext>(contextQuery.queryKey)?.app?.siteId ?? null
    if (!siteId || hasSeen(siteId)) return
    let active = true
    // Always re-read: the plan can change between visits, so a cached answer is not trusted.
    client.fetchQuery({ ...overviewQuery, staleTime: 0 }).then(
      (fresh) => { if (active) readyTicket.current = isFirstFreePublish(fresh) ? { siteId } : null },
      () => { if (active) readyTicket.current = null },
    )
    return () => { active = false }
  }, [client])

  const prepare = useCallback((): FirstPublishTicket => {
    const ticket = readyTicket.current
    const siteId = pinnedDashboardSiteId() ?? client.getQueryData<AppRouterContext>(contextQuery.queryKey)?.app?.siteId ?? null
    if (!ticket || ticket.siteId !== siteId || hasSeen(ticket.siteId)) return null
    return ticket
  }, [client])

  const confirm = useCallback((ticket: FirstPublishTicket) => {
    if (!ticket || hasSeen(ticket.siteId)) return
    markSeen(ticket.siteId)
    setShownFor(ticket.siteId)
  }, [])

  const dismiss = useCallback(() => setShownFor(null), [])

  return { prepare, confirm, visible: shownFor !== null, dismiss }
}

export function FirstPublishNudge({ nudge }: { nudge: Pick<FirstPublishNudgeState, 'visible' | 'dismiss'> }) {
  if (!nudge.visible) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 text-muted-foreground">
        <span className="font-medium text-foreground">Your first post is live.</span>{' '}
        Search engines don’t index blogs on the free plan.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }} target="_blank" rel="noopener noreferrer">
          Upgrade to Cloud <ExternalLink aria-hidden data-icon="inline-end" />
        </Link>
      </Button>
      <Button type="button" size="lg" variant="ghost" className="w-11 px-0" aria-label="Dismiss" onClick={nudge.dismiss}>
        <X aria-hidden />
      </Button>
    </div>
  )
}
