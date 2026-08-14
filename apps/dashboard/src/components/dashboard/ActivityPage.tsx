'use client'

import { useEffect, useRef, useState } from 'react'
import { ActivityLogIcon, ReloadIcon } from '@radix-ui/react-icons'
import {
  Button,
  LoadError,
  formatDateTime,
  labelAction,
} from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, Panel } from '~/components/dashboard/blocks'
import {
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vc/ui'
import { ListRow } from '~/components/dashboard/blocks'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { loadActivityPage } from '~/lib/api-client'

type ActivityEvent = {
  action: string
  summary: string
  actor_type: string
  actor_name: string
  created_at: number
}

// The trust surface: tell at a glance whether you, a token, or an agent acted.
// We bucket to three reader-facing categories so the empty state, filter chips,
// and badges all speak the same language.
type ActorCategory = 'you' | 'agent' | 'system'
type ActorFilter = 'all' | ActorCategory

function actorCategory(type: string): ActorCategory {
  switch (type) {
    case 'human':
      return 'you'
    case 'api_key':
      return 'agent'
    default:
      return 'system'
  }
}

const ACTOR_CATEGORY_LABEL: Record<ActorCategory, string> = {
  you: 'You',
  agent: 'Agent',
  system: 'System',
}

const ACTOR_DOT: Record<ActorCategory, string> = {
  you: 'bg-foreground',
  agent: 'bg-muted-foreground',
  system: 'bg-muted-foreground/60',
}

function ActorBadge({ actorType }: { actorType: string }) {
  const category = actorCategory(actorType)
  return (
    <Badge variant="outline" className="gap-1.5 font-mono text-[10px]">
      <span aria-hidden className={`size-1.5 rounded-full ${ACTOR_DOT[category]}`} />
      {ACTOR_CATEGORY_LABEL[category]}
    </Badge>
  )
}

function ActivitySkeleton() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Panel title="Activity log">
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
  const [actorFilter, setActorFilter] = useState<ActorFilter>('all')

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

  // Filter the accumulated list client-side; "Load more" keeps appending to the
  // accumulated list, so the filter keeps working across pagination.
  const filteredEvents =
    actorFilter === 'all'
      ? events
      : events.filter((event) => actorCategory(event.actor_type) === actorFilter)

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every meaningful action from you or an agent, with enough context to debug and trust the system."
      />
      <Panel title="Activity log" meta={<Badge variant="outline">{filteredEvents.length} events</Badge>}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={actorFilter}
            onValueChange={(value) => setActorFilter((value as ActorFilter | undefined) ?? 'all')}
            aria-label="Filter activity by actor"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="you">You</ToggleGroupItem>
            <ToggleGroupItem value="agent">Agent</ToggleGroupItem>
            <ToggleGroupItem value="system">System</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {events.length === 0 ? (
          <EmptyState
            icon={<ActivityLogIcon />}
            title="No activity yet"
            description="Create a post, upload media, or issue an API token and this log will fill in automatically."
          />
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No matching events</p>
            <p className="text-sm text-muted-foreground">
              Nothing from this actor yet. Try a different filter.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop: flat audit table, no date grouping. Full timestamp in one cell. */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Timestamp</TableHead>
                  <TableHead className="w-40">Actor</TableHead>
                  <TableHead className="w-48">Action</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((event) => (
                  <TableRow key={`${event.action}-${event.created_at}-${event.summary}`}>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <ActorBadge actorType={event.actor_type} />
                        <span className="max-w-[12rem] truncate font-mono text-xs text-muted-foreground">
                          {event.actor_name}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {labelAction(event.action)}
                    </TableCell>
                    <TableCell className="w-full max-w-0">
                      <span className="block truncate text-pretty font-sans text-sm text-foreground">
                        {event.summary}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Mobile: timeline-style rows, no date grouping. */}
            <div className="grid gap-0 md:hidden">
              {filteredEvents.map((event) => (
                <ListRow
                  key={`${event.action}-${event.created_at}-${event.summary}`}
                  title={
                    <span className="text-pretty font-sans text-base font-medium leading-6 text-foreground">
                      {event.summary}
                    </span>
                  }
                  description={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs text-muted-foreground">
                        {labelAction(event.action)}
                      </span>
                      <span aria-hidden className="text-muted-foreground/40">·</span>
                      <ActorBadge actorType={event.actor_type} />
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {event.actor_name}
                      </span>
                    </span>
                  }
                  actions={
                    <time className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </time>
                  }
                />
              ))}
            </div>
          </>
        )}

        {hasMore || loadMoreError ? (
          <>
            {hasMore ? (
              <div className="mt-3 flex justify-center">
                <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                  <ReloadIcon aria-hidden data-icon="inline-start" />
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
