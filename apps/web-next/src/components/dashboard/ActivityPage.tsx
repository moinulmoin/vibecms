'use client'

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@vc/ui'
import { useEffect, useState } from 'react'
import {
  EmptyState,
  PageHeader,
  Panel,
  formatDateTime,
  labelAction,
} from '~/components/dashboard/DashboardLayout'
import { loadActivityPage } from '~/server/dashboard-pages-fn'

type ActivityEvent = { action: string; summary: string; actor_name: string; created_at: number }

export function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadActivityPage()
      .then((data) => {
        if (!cancelled) setEvents(data.events)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load activity.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>
  if (!events) return <p className="font-mono text-sm text-muted-foreground">Loading activity…</p>

  return (
    <>
      <PageHeader
        kicker="Audit Log"
        title="Activity"
        description="Every meaningful action - yours, an API token's, or an agent's - is logged here for trust and debugging."
      />
      <Panel title="Recent Events" meta={`${events.length} shown`}>
        {events.length ? (
          <>
            <div className="relative grid gap-0 md:hidden">
              <div aria-hidden className="pointer-events-none absolute bottom-3 left-[11px] top-3 w-px bg-[color:var(--hairline)]" />
              {events.map((event) => (
                <article
                  className="relative grid grid-cols-[auto_1fr] gap-3 py-3 first:pt-0 last:pb-0"
                  key={`${event.action}-${event.created_at}-${event.summary}`}
                >
                  <div
                    aria-hidden
                    className="relative z-[1] mt-1.5 size-[9px] shrink-0 rounded-full bg-brand-bright ring-2 ring-background"
                  />
                  <div className="min-w-0 rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
                    <p className="font-sans text-sm font-medium leading-6 text-foreground">{event.summary}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.06em]">
                        {labelAction(event.action)}
                      </Badge>
                      <span className="font-mono text-xs text-brand-bright">{event.actor_name}</span>
                    </div>
                    <time className="mt-2 block font-mono text-[11px] text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </time>
                  </div>
                </article>
              ))}
            </div>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[11px] uppercase tracking-[0.1em]">Event</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase tracking-[0.1em]">Action</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase tracking-[0.1em]">Actor</TableHead>
                  <TableHead className="font-mono text-[11px] uppercase tracking-[0.1em]">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={`${event.action}-${event.created_at}-${event.summary}`}>
                    <TableCell className="font-sans text-sm font-medium text-foreground">{event.summary}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.06em]">
                        {labelAction(event.action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-brand-bright">{event.actor_name}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <EmptyState
            title="No activity yet"
            description="Create a post, upload media, or issue an API token and this log will fill in automatically."
          />
        )}
      </Panel>
    </>
  )
}