'use client'

import { useEffect, useRef, useState } from 'react'
import { ActivityLogIcon } from '@radix-ui/react-icons'
import {
  Button,
  DataRow,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  formatDateTime,
  labelAction,
} from '~/components/dashboard/DashboardLayout'
import { Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { loadActivityPage } from '~/lib/api-client'

type ActivityEvent = {
  action: string
  summary: string
  actor_type: string
  actor_name: string
  created_at: number
}

// Map the stored actor_type to a reader-facing label. This is the trust surface:
// the point is to tell at a glance whether you, a token, or an agent acted.
function actorTypeLabel(type: string) {
  switch (type) {
    case 'human':
      return 'Human'
    case 'agent':
      return 'Agent'
    case 'api_key':
      return 'Token'
    case 'system':
      return 'System'
    default:
      return 'Unknown'
  }
}

function ActivitySkeleton() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Panel title="Recent events">
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </Panel>
    </>
  )
}

export function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadActivityPage({})
      .then((data) => {
        if (!cancelled) {
          setEvents(data.events)
          setHasMore(data.hasMore)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load activity.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadingMoreRef = useRef(false)
  async function loadMore() {
    if (!events || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const data = await loadActivityPage({ offset: events.length })
      setEvents((prev) => [...(prev ?? []), ...data.events])
      setHasMore(data.hasMore)
    } catch {
      setLoadMoreError('Could not load more activity. Your current log is still available.')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!events) return <ActivitySkeleton />

  return (
    <>
      <PageHeader
        kicker="Audit trail"
        title="Activity"
        description="Every meaningful action from you or an agent, with enough context to debug and trust the system."
      />
      <Panel title="Recent events" meta={<Badge variant="outline">{events.length} shown</Badge>}>
        {events.length ? (
          <div className="grid gap-2">
            {events.map((event) => (
              <DataRow
                className="md:grid-cols-[1fr_auto] md:items-start"
                key={`${event.action}-${event.created_at}-${event.summary}`}
              >
                <div className="min-w-0 space-y-1.5">
                  <p className="text-pretty font-sans text-base font-medium leading-6 text-foreground">
                    {event.summary}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-xs text-muted-foreground">
                      {labelAction(event.action)}
                    </span>
                    <span aria-hidden className="text-muted-foreground/40">
                      ·
                    </span>
                    <Badge
                      variant="outline"
                      className="gap-1 font-mono text-[10px]"
                    >
                      {actorTypeLabel(event.actor_type)}
                    </Badge>
                    <span className="truncate font-mono text-xs text-muted-foreground">{event.actor_name}</span>
                  </div>
                </div>
                <time className="font-mono text-xs tabular-nums text-muted-foreground md:text-right">
                  {formatDateTime(event.created_at)}
                </time>
              </DataRow>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ActivityLogIcon />}
            title="No activity yet"
            description="Create a post, upload media, or issue an API token and this log will fill in automatically."
          />
        )}
        {hasMore || loadMoreError ? (
          <>
            {hasMore ? (
              <div className="mt-3 flex justify-center">
                <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
            {loadMoreError ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-destructive" role="alert">
                <span>{loadMoreError}</span>
                <Button type="button" variant="link" className="h-auto p-0 text-destructive underline" onClick={() => void loadMore()}>
                  Try again
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </Panel>
    </>
  )
}
