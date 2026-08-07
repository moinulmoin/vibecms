'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
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
import {
  Badge,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vc/ui'
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
  you: 'bg-emerald-500',
  agent: 'bg-amber-500',
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

type DayGroup = { key: number; label: string; events: ActivityEvent[] }

function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const dayGroupFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const dayGroupYearFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const timeOnlyFormatter = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })

function dayGroupLabel(ms: number): string {
  const diffDays = Math.round((startOfDayMs(Date.now()) - startOfDayMs(ms)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const d = new Date(ms)
  // Include year for events older than 7 days so "Jul 16" doesn't look like an ID
  if (diffDays > 7) return dayGroupYearFormatter.format(d)
  return dayGroupFormatter.format(d)
}

export function formatTimeOnly(value: number | string | Date): string {
  const d = typeof value === 'number' ? new Date(value * 1000) : value instanceof Date ? value : new Date(value)
  return timeOnlyFormatter.format(d)
}

function groupByDay(events: ActivityEvent[]): DayGroup[] {
  const byDay = new Map<number, ActivityEvent[]>()
  for (const event of events) {
    const day = startOfDayMs(event.created_at * 1000)
    const list = byDay.get(day)
    if (list) list.push(event)
    else byDay.set(day, [event])
  }
  const groups: DayGroup[] = []
  for (const [key, dayEvents] of byDay) {
    // Newest first within each day.
    dayEvents.sort((a, b) => b.created_at - a.created_at)
    groups.push({ key, label: dayGroupLabel(key), events: dayEvents })
  }
  // Newest day first overall.
  groups.sort((a, b) => b.key - a.key)
  return groups
}

function DayHeader({ label }: { label: string }) {
  return (
    <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
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
  const groups = groupByDay(filteredEvents)

  return (
    <>
      <PageHeader
        kicker="Audit trail"
        title="Activity"
        description="Every meaningful action from you or an agent, with enough context to debug and trust the system."
      />
      <Panel
        title="Recent events"
        meta={<Badge variant="outline">{filteredEvents.length} shown</Badge>}
      >
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
            {/* Desktop table */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4} className="border-0 px-4 pb-1 pt-4">
                        <DayHeader label={group.label} />
                      </TableCell>
                    </TableRow>
                    {group.events.map((event) => (
                      <TableRow
                        key={`${event.action}-${event.created_at}-${event.summary}`}
                      >
                        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                          {formatTimeOnly(event.created_at)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <ActorBadge actorType={event.actor_type} />
                            <span className="max-w-[14rem] truncate font-mono text-xs text-muted-foreground">
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
                  </Fragment>
                ))}
              </TableBody>
            </Table>

            {/* Mobile cards */}
            <div className="grid gap-2 md:hidden">
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <div className="flex items-center gap-2 pt-3 first:pt-0">
                    <DayHeader label={group.label} />
                    <Separator className="flex-1" />
                  </div>
                  {group.events.map((event) => (
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
                          <ActorBadge actorType={event.actor_type} />
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {event.actor_name}
                          </span>
                        </div>
                      </div>
                      <time className="font-mono text-xs tabular-nums text-muted-foreground md:text-right">
                        {formatDateTime(event.created_at)}
                      </time>
                    </DataRow>
                  ))}
                </Fragment>
              ))}
            </div>
          </>
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
