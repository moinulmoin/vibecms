import { CHROME_LABELS, INDEX_LABELS, HEADER_LABELS } from '@vc/config'
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
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@vc/ui'
import { Button, LoadError, formatDateTime, formatRelative } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, PageSkeleton, PageTabs } from '~/components/dashboard/blocks'
import { Tabs } from '~/components/ui/tabs'
import { canManageDashboardContent } from '~/lib/dashboard-role'
import { personLabel } from '~/lib/people'
import { activitySummary } from '~/lib/activity-copy'
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
  ['post.deleted', Trash2],
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

const SITE_FIELD_LABELS: Array<[string, string]> = [
  ['accent', 'Accent'], ['themeAccent', 'Accent'],
  ['font', 'Font'], ['themeFont', 'Font'],
  ['template', 'Template'], ['theme', 'Template'],
  ['radius', 'Corners'], ['themeRadius', 'Corners'],
  ['width', 'Reading width'], ['themeWidth', 'Reading width'],
  ['chrome', 'Navigation'], ['themeChrome', 'Navigation'],
  ['index', 'Home page'], ['themeIndex', 'Home page'],
  ['header', 'Article header'], ['themeHeader', 'Article header'],
  ['mode', 'Color mode'], ['themeMode', 'Color mode'],
  ['name', 'Name'], ['description', 'Description'],
  ['enabled', 'Signup form'],
  ['heading', 'Signup heading'], ['signupHeading', 'Signup heading'],
  ['subtext', 'Signup description'],
  ['subheading', 'Signup description'], ['signupDescription', 'Signup description'],
  ['buttonLabel', 'Signup button'],
  ['buttonText', 'Signup button'], ['signupButtonText', 'Signup button'],
  ['audience', 'Audience'], ['voiceSummary', 'Voice summary'], ['voiceTone', 'Voice tone'],
]

function displayChangeValue(value: unknown, label?: string) {
  if (value == null || value === '') return ['Accent', 'Font', 'Corners', 'Reading width', 'Color mode', 'Navigation', 'Home page', 'Article header'].includes(label ?? '') ? 'template default' : 'empty'
  if (label === 'Navigation' && typeof value === 'string') return CHROME_LABELS[value as keyof typeof CHROME_LABELS] ?? value
  if (label === 'Home page' && typeof value === 'string') return INDEX_LABELS[value as keyof typeof INDEX_LABELS] ?? value
  if (label === 'Article header' && typeof value === 'string') return HEADER_LABELS[value as keyof typeof HEADER_LABELS] ?? value
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

// The summary already says the status moved ("Archived …", "Published …").
const STATUS_ACTIONS = new Set(['post.archived', 'post.unarchived', 'post.published'])

/** Render supported site snapshot fields; API-provided post diff lines stay intact. */
export function activityChanges(event: ActivityEvent): string[] {
  if (!event.action.startsWith('site.') || !event.before || !event.after) {
    const changes = event.changes ?? []
    return STATUS_ACTIONS.has(event.action) ? changes.filter((line) => !line.startsWith('Status ')) : changes
  }
  const lines = SITE_FIELD_LABELS.flatMap(([field, label]) => {
    if (!(field in event.before!) || !(field in event.after!)) return []
    const before = displayChangeValue(event.before![field], label)
    const after = displayChangeValue(event.after![field], label)
    return before !== null && after !== null && before !== after ? [`${label}: ${before} → ${after}`] : []
  })
  return lines.length ? lines : event.changes ?? []
}

const CHANGE_LABELS = [
  'Title', 'URL', 'Status', 'Name', 'Alt text', 'Body', 'Description', 'Byline', 'Credit your agent',
  'Search title', 'Search description', 'Template', 'Accent', 'Font', 'Corners', 'Reading width', 'Navigation', 'Home page', 'Article header', 'Color mode',
  'Signup form', 'Signup heading', 'Signup description', 'Signup button', 'Audience', 'Voice summary', 'Voice tone',
]
// Longest first so "Signup heading" wins over a shorter label that prefixes it.
// Server lines read "Label “a” → “b”"; lines built here read "Label: a → b".
const CHANGE_LINE = new RegExp(`^(${[...CHANGE_LABELS].sort((a, b) => b.length - a.length).join('|')}):? (.+) → (.+)$`)
const unquote = (value: string) => value.replace(/^“([\s\S]*)”$/, '$1')

export type ParsedChange = { label: string; before?: string; after?: string; text?: string }

/**
 * "Template “Magazine” → “Editorial”" (server) and "Accent: blue → rust"
 * (client) both become label + before/after; anything else stays text.
 */
export function parseChange(line: string): ParsedChange {
  const match = CHANGE_LINE.exec(line)
  if (match) return { label: match[1]!, before: unquote(match[2]!), after: unquote(match[3]!) }
  const body = /^Body (.+)$/.exec(line)
  if (body) return { label: 'Body', text: body[1]! }
  return { label: '', text: line }
}

/** "Today", "Yesterday", "Monday · Sep 28", "Sep 27", or "Sep 27, 2025". */
export function activityDayLabel(seconds: number, now = new Date()) {
  const day = new Date(seconds * 1000)
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(now) - startOf(day)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) {
    return `${day.toLocaleDateString(undefined, { weekday: 'long' })} · ${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  return day.toLocaleDateString(undefined, day.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Consecutive events that share a calendar day (events arrive newest first). */
export function groupByDay(events: ActivityEvent[], now = new Date()) {
  const groups: Array<{ label: string; events: ActivityEvent[] }> = []
  for (const event of events) {
    const label = activityDayLabel(event.created_at, now)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.events.push(event)
    else groups.push({ label, events: [event] })
  }
  return groups
}

const VALUE_PLACEHOLDERS = new Set(['empty', 'template default'])

function ChangeValue({ value, strong }: { value: string; strong?: boolean }) {
  if (VALUE_PLACEHOLDERS.has(value)) return <span className="italic text-muted-foreground/80">{value}</span>
  return <span className={strong ? 'font-medium text-foreground' : 'text-muted-foreground'}>{value}</span>
}

function ChangeList({ changes }: { changes: string[] }) {
  return (
    // Narrow screens: each label sits above its value.
    // From sm up: a two-column label/value grid.
    <dl className="mt-2.5 grid w-fit max-w-full gap-y-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px] leading-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
      {changes.map((line) => {
        const change = parseChange(line)
        return (
          <div key={line} className="grid min-w-0 sm:contents">
            {change.label ? <dt className="text-muted-foreground">{change.label}</dt> : null}
            <dd className={cn('min-w-0 break-words', !change.label && 'sm:col-span-2')}>
              {change.text ? (
                <span className="text-foreground">{change.text}</span>
              ) : (
                <>
                  <ChangeValue value={change.before!} />
                  <span aria-label="changed to" className="mx-1.5 text-muted-foreground/70">→</span>
                  <ChangeValue value={change.after!} strong />
                </>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** "Edited Terminal notes (tags)" → verb, subject, detail. Non-post rows stay whole. */
export function splitSummary(summary: string, entityType?: string) {
  if (entityType !== 'post') return { verb: summary, subject: '', detail: '' }
  const match = /^(\S+) (.+)$/.exec(summary)
  if (!match) return { verb: summary, subject: '', detail: '' }
  // Only "Edited …" (field list) and a canceled schedule carry a trailing
  // note; other titles keep their parentheses.
  const fields = match[1] === 'Edited' || match[2]!.endsWith(' (scheduled publish canceled)')
    ? /^(.+) \(([^()]+)\)$/.exec(match[2]!)
    : null
  return fields
    ? { verb: match[1]!, subject: fields[1]!, detail: fields[2]! }
    : { verb: match[1]!, subject: match[2]!, detail: '' }
}

function ActivityRow({ event, canEdit, me }: { event: ActivityEvent; canEdit: boolean; me: { email?: string | null; name?: string | null } | undefined }) {
  const Icon = activityIcon(event.action)
  const agent = isAgent(event.actor_type)
  // Viewers can't open the editor, so their rows stay plain text.
  const postId = canEdit && event.entity_type === 'post' && event.entity_id && event.action !== 'post.archived' && event.action !== 'post.deleted' ? event.entity_id : null
  const summary = activitySummary(event.action, event.summary)
  const parts = splitSummary(summary, event.entity_type)
  const changes = activityChanges(event)
  const today = activityDayLabel(event.created_at) === 'Today'
  const sentence = parts.subject ? (
    <>
      {parts.verb} <span className="font-medium">{parts.subject}</span>
      {parts.detail ? <span className="text-muted-foreground"> · {parts.detail}</span> : null}
    </>
  ) : summary

  return (
    <li className={cn('group relative -mx-3 flex items-start gap-3.5 rounded-lg px-3 py-3.5 transition-colors', postId && 'hover:bg-muted/50')}>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground',
          event.action === 'post.published' && 'border-brand-bright/40 bg-brand-bright/10 text-foreground',
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
              className="text-foreground no-underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {sentence}
            </Link>
          ) : (
            sentence
          )}
        </p>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {agent ? <Bot aria-hidden className="size-3.5 shrink-0" /> : null}
          <span className="truncate">{agent ? event.actor_name : event.actor_type === 'human' ? personLabel(event.actor_name, me) : 'vibecms'}</span>
          {agent ? <span className="sr-only">(agent)</span> : null}
        </p>
        {changes.length ? <ChangeList changes={changes} /> : null}
      </div>
      <time
        dateTime={new Date(event.created_at * 1000).toISOString()}
        title={formatDateTime(event.created_at)}
        className="shrink-0 whitespace-nowrap pt-0.5 text-sm tabular-nums text-muted-foreground"
      >
        {today
          ? formatRelative(event.created_at)
          : new Date(event.created_at * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
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
        <div className="grid gap-8">
          {groupByDay(events).map((group) => (
            <section key={group.label} aria-labelledby={`activity-${group.label}`}>
              <h2
                id={`activity-${group.label}`}
                className="mb-1 border-b border-[color:var(--hairline)] pb-2 text-sm font-medium text-muted-foreground"
              >
                {group.label}
              </h2>
              <ol aria-label={`Activity, ${group.label}`} className="grid">
                {group.events.map((event, index) => (
                  <ActivityRow key={activityKey(event, index)} event={event} canEdit={canEdit} me={me} />
                ))}
              </ol>
            </section>
          ))}
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
