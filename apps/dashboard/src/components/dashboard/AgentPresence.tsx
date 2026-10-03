import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { dashboardMutationSignal } from '~/lib/api-client'
import { connectQuery, queryKeys } from '~/lib/queries'
import type { ApiKeyListItem } from '~/types/dashboard'

/** A key used this recently counts as an agent at work right now. */
export const ACTIVE_WINDOW_SECONDS = 120
const POLL_MS = 20_000

export function activeAgents(keys: ApiKeyListItem[], nowSeconds: number) {
  return keys
    .filter((key) => key.revokedAt == null && key.lastUsedAt != null && nowSeconds - key.lastUsedAt < ACTIVE_WINDOW_SECONDS)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
}

/** Latest request from any live key; 0 when none has been used. */
export function newestAgentRequest(keys: ApiKeyListItem[]) {
  return keys.reduce((latest, key) => (key.revokedAt == null && (key.lastUsedAt ?? 0) > latest ? key.lastUsedAt! : latest), 0)
}

export function presenceLabel(active: Array<Pick<ApiKeyListItem, 'name'>>) {
  if (active.length === 0) return null
  return active.length === 1 ? `${active[0]!.name} is working` : `${active.length} agents are working`
}

function useNowSeconds(intervalMs: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * "My agent is working": shown in the top bar while an agent key is in use.
 * While it works, the posts, overview, and activity views refresh on their
 * own, so its drafts appear without a reload.
 */
export function AgentPresence({ role }: { role?: 'owner' | 'editor' | 'viewer' }) {
  const enabled = role === 'owner' || role === 'editor'
  const queryClient = useQueryClient()
  const now = useNowSeconds(POLL_MS / 2)
  // Polls only while the tab is visible (React Query's default), and stops
  // once this tab knows another tab switched sites.
  const connect = useQuery({ ...connectQuery, enabled: enabled && !dashboardMutationSignal().aborted, refetchInterval: POLL_MS })
  const active = activeAgents(connect.data?.apiKeys ?? [], now)
  const newest = newestAgentRequest(connect.data?.apiKeys ?? [])
  const seen = useRef<number | null>(null)

  useEffect(() => {
    if (!connect.data) return
    // The first loaded list is the baseline (even if no agent has worked
    // yet); any newer agent request after it refreshes the views.
    if (seen.current !== null && newest > seen.current) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview })
      void queryClient.invalidateQueries({ queryKey: queryKeys.postsAll })
      void queryClient.invalidateQueries({ queryKey: queryKeys.activityAll })
    }
    seen.current = Math.max(seen.current ?? 0, newest)
  }, [connect.data, newest, queryClient])

  const label = presenceLabel(active)
  if (!label) return null
  return (
    <Link
      to="/dashboard/activity"
      search={{ actor: 'agent' }}
      className="inline-flex h-8 min-w-0 items-center gap-2 rounded-full border border-brand-bright/30 bg-brand-bright/[0.08] px-2.5 text-[13px] font-medium text-foreground no-underline transition-colors hover:bg-brand-bright/15 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
      title="See what your agents did"
    >
      <span aria-hidden className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full rounded-full bg-brand-bright opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-brand-bright" />
      </span>
      <span className="max-w-60 truncate max-sm:sr-only">{label}</span>
    </Link>
  )
}
