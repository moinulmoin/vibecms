import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Activity,
  Archive,
  ArchiveRestore,
  Bot,
  FilePlus2,
  Globe,
  History,
  ImageMinus,
  ImagePlus,
  Images,
  KeyRound,
  PenLine,
  Settings2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@vc/ui'
import { Button, LoadError, formatDateTime, formatRelative } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, PageSkeleton, PageTabs } from '~/components/dashboard/blocks'
import { Tabs } from '~/components/ui/tabs'
import { canManageDashboardContent } from '~/lib/dashboard-role'
import { personLabel } from '~/lib/people'
import { emptyPostEditorSearch } from '~/lib/dashboard-search'
import { activityQuery, contextQuery } from '~/lib/queries'
import type { ActivityEvent } from '~/types/dashboard'

export type ActivityActor = 'all' | 'human' | 'agent'

const ACTION_ICONS: Array<[prefix: string, Icon: LucideIcon]> = [
  ['post.created', FilePlus2],
  ['post.updated', PenLine],
  ['post.published', Globe],
  ['post.archived', Archive],
  ['post.unarchived', ArchiveRestore],
  ['post.restored', History],
  ['asset.uploaded', ImagePlus],
  ['asset.deleted', ImageMinus],
  ['asset.', Images],
  ['api_key.', KeyRound],
  ['site.voice', Sparkles],
  ['site.', Settings2],
  ['autoseopilot.', ShieldCheck],
]

export function activityIcon(action: string): LucideIcon {
  return ACTION_ICONS.find(([prefix]) => action.startsWith(prefix))?.[1] ?? Activity
}

const SUMMARY_OVERRIDES: Record<string, string> = {
  'api_key.revoked': 'Deleted an agent token',
}

function summaryFor(event: ActivityEvent) {
  return SUMMARY_OVERRIDES[event.action] ?? event.summary.replace(/^Created API key /, 'Created agent key ')
}

function isAgent(actorType: string) {
  return actorType === 'api_key' || actorType === 'agent'
}

/** Stable, collision-free key even for legacy rows without an id. */
export function activityKey(event: ActivityEvent, index: number) {
  return event.id ?? `${event.created_at}:${event.action}:${event.entity_id ?? ''}:${index}`
}

/**
 * Pages are offset-based and newest-first, so events written between "Show
 * older" clicks shift rows onto the next page. Drop repeats by id.
 */
export function uniqueActivityEvents(pages: Array<{ events: ActivityEvent[] }>) {
  const seen = new Set<string>()
  const events: ActivityEvent[] = []
  for (const page of pages) {
    for (const event of page.events) {
      if (event.id) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
      }
      events.push(event)
    }
  }
  return events
}

function ActivityRow({ event, canEdit, me }: { event: ActivityEvent; canEdit: boolean; me: { email?: string | null; name?: string | null } | undefined }) {
  const Icon = activityIcon(event.action)
  const agent = isAgent(event.actor_type)
  // Viewers can't open the editor, so their rows stay plain text.
  const postId = canEdit && event.entity_type === 'post' && event.entity_id && event.action !== 'post.archived' ? event.entity_id : null
  const summary = summaryFor(event)

  return (
    <li className="group relative flex items-start gap-3.5 border-b border-[color:var(--hairline)] py-4 last:border-b-0">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground',
          event.action === 'post.published' && 'text-primary',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] leading-6 text-foreground">
          {postId ? (
            <Link
              to="/dashboard/posts/$postId/edit"
              params={{ postId }}
              search={emptyPostEditorSearch}
              className="underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {summary}
            </Link>
          ) : (
            summary
          )}
        </p>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {agent ? <Bot aria-hidden className="size-3.5 shrink-0" /> : null}
          <span className="truncate">{agent ? event.actor_name : event.actor_type === 'human' ? personLabel(event.actor_name, me) : 'vibecms'}</span>
          {agent ? <span className="sr-only">(agent)</span> : null}
        </p>
        {event.changes?.length ? (
          <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
            {event.changes.map((change) => (
              <li key={change} className="truncate font-mono text-[0.8125rem]">
                {change}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <time
        dateTime={new Date(event.created_at * 1000).toISOString()}
        title={formatDateTime(event.created_at)}
        className="shrink-0 whitespace-nowrap pt-0.5 text-sm tabular-nums text-muted-foreground"
      >
        {formatRelative(event.created_at)}
      </time>
    </li>
  )
}

export function ActivityPage({ actor = 'all' }: { actor?: ActivityActor }) {
  const navigate = useNavigate()
  const query = useInfiniteQuery(activityQuery(actor))
  const events = query.data ? uniqueActivityEvents(query.data.pages) : []

  const context = useQuery(contextQuery).data
  const me = context?.app?.user
  const canEdit = canManageDashboardContent(context?.app?.actor.role)

  return (
    <>
      <PageHeader title="Activity" description="What you and your agents changed on this blog." />
      <Tabs
        value={actor}
        onValueChange={(value) => {
          void navigate({ to: '/dashboard/activity', search: value === 'human' || value === 'agent' ? { actor: value } : {} })
        }}
        className="gap-0"
      >
        <PageTabs
          label="Show activity from"
          tabs={[
            { value: 'all', label: 'Everyone' },
            { value: 'human', label: 'People' },
            { value: 'agent', label: 'Agents' },
          ]}
        />
      </Tabs>
      {query.isError && !query.data ? (
        <LoadError message="Activity didn’t load. Check your connection and try again." onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <PageSkeleton variant="list" withHeader={false} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title={actor === 'all' ? 'Nothing here yet' : actor === 'agent' ? 'No agent activity yet' : 'No activity from people yet'}
          description={
            actor === 'agent'
              ? 'When a connected agent drafts or edits a post, it shows up here.'
              : 'Posts, uploads, and settings changes show up here as they happen.'
          }
        />
      ) : (
        <div>
          <ol aria-label="Activity" className="grid">
            {events.map((event, index) => (
              <ActivityRow key={activityKey(event, index)} event={event} canEdit={canEdit} me={me} />
            ))}
          </ol>
          {query.hasNextPage || query.isFetchNextPageError ? (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {query.isFetchNextPageError ? (
                <p role="alert" className="text-sm text-destructive">Couldn’t load older activity.</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? 'Loading…' : query.isFetchNextPageError ? 'Try again' : 'Show older'}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
