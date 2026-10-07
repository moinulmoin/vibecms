import { BRAND, FREE_TIER, MEDIA } from '@vc/config'
import { Activity, Bot, FileText, Pencil, Plus, Rocket } from 'lucide-react'
import { isAgentActor, reviewLabel } from '~/lib/post-review'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { contextQuery, overviewQuery } from '~/lib/queries'
import { personLabel } from '~/lib/people'
import { activitySummary, isSystemActor } from '~/lib/activity-copy'
import type { DashboardData } from '~/types/dashboard'
import type { z } from 'zod'
import { dashboardDataSchema } from '~/lib/dashboard-response-schemas'
import { scheduledLabel } from './editor/schedule-label'

type DashboardApiResponse = z.infer<typeof dashboardDataSchema>
type DashboardPostStatus = DashboardData['recentPosts'][number]['status']

function isDashboardPostStatus(value: string): value is DashboardPostStatus {
  return value === 'draft' || value === 'published' || value === 'archived'
}

export function narrowDashboardData(result: DashboardApiResponse): DashboardData {
  const recentPosts: DashboardData['recentPosts'] = []
  for (const post of result.recentPosts) {
    if (!isDashboardPostStatus(post.status)) continue
    recentPosts.push({ ...post, status: post.status })
  }
  const recentDrafts: DashboardData['recentDrafts'] = []
  for (const post of result.recentDrafts) {
    if (!isDashboardPostStatus(post.status)) continue
    recentDrafts.push({ ...post, status: post.status })
  }
  const needsReview = result.needsReview
    ? result.needsReview.flatMap((post) => (isDashboardPostStatus(post.status) ? [{ ...post, status: post.status }] : []))
    : undefined
  return { ...result, subscriberCount: result.subscriberCount ?? 0, recentPosts, recentDrafts, needsReview }
}

export function ReviewBadge({ post }: { post: Parameters<typeof reviewLabel>[0] }) {
  const label = reviewLabel(post)
  if (!label) return <StatusBadge status={post.status} className="w-fit" />
  return <StatusBadge status="pending" label={label} className="w-fit normal-case" />
}

import {
  Button,
  LoadError,
  formatDate,
  formatDateTime,
  formatRelative,
} from '~/components/dashboard/DashboardLayout'
import {
  EmptyState,
  PageHeader,
  PageSkeleton,
  Section,
  StatCard,
  StatCardGrid,
  StatusBadge,
  Step,
  Steps,
} from '~/components/dashboard/blocks'
import { emptyDashboardStatusSearch, emptyPostEditorSearch, emptyPostsListSearch, postsListSearch } from '~/lib/dashboard-search'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
}

export function postEditorLink(postId: string) {
  return { to: '/dashboard/posts/$postId/edit' as const, params: { postId } }
}

export function overviewEntitlementBadge(
  billing: DashboardData['billing'],
): string | null {
  if (billing.managed?.effective) return 'Managed access'
  if (billing.effective) return null
  if (billing.managed?.status === 'revoked') return 'Managed revoked'
  if (billing.managed) return 'Managed expired'
  if (billing.status === 'none') return 'Free plan'
  if (billing.status === 'past_due') return 'Past due'
  if (billing.status === 'canceled') return 'Canceled'
  if (billing.status === 'unpaid') return 'Unpaid'
  return null
}

function UsageMeter({ label, status }: { label: string; status: DashboardData['apiUsage']['calls']['month'] }) {
  const limit = Math.max(status.limit, 1)
  const percent = Math.min(100, Math.round((status.used / limit) * 100))
  const near = percent >= 80
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">
          {status.used.toLocaleString()}
          <span className="text-muted-foreground"> / {status.limit.toLocaleString()}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={status.limit}
        aria-valuenow={status.used}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={near ? 'h-full rounded-full bg-[color:var(--warning)]' : 'h-full rounded-full bg-foreground/70'}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function AgentUsage({ usage, tokenCount, canEdit, paid }: { usage: DashboardData['apiUsage']; tokenCount: number; canEdit: boolean; paid: boolean }) {
  const keys = `${tokenCount} active ${tokenCount === 1 ? 'key' : 'keys'}`
  return (
    <Section
      title="Agent usage"
      description={
        usage.enforced
          ? `Requests from your agents this month. Resets ${formatDate(usage.calls.month.resetsAt)}.`
          : 'Agent requests are not limited on a self-hosted install.'
      }
      action={canEdit ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>{keys}</Link>
        </Button>
      ) : <span className="text-sm text-muted-foreground">{keys}</span>}
    >
      {usage.enforced && paid ? (
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
          <p>Requests this month: {usage.calls.month.used.toLocaleString()} <span className="text-muted-foreground">· Unlimited, fair use</span></p>
          <p>Writes this month: {usage.writes.month.used.toLocaleString()} <span className="text-muted-foreground">· Unlimited, fair use</span></p>
        </div>
      ) : usage.enforced ? (
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
          <UsageMeter label="Requests" status={usage.calls.month} />
          <UsageMeter label="Writes" status={usage.writes.month} />
        </div>
      ) : null}
    </Section>
  )
}

function Stat({ label, value, detail, to, search }: {
  label: string
  value: string | number
  detail: string
  to?: '/dashboard/posts' | '/dashboard/subscribers' | '/dashboard/media'
  search?: Record<string, unknown>
}) {
  const body = <StatCard label={label} value={value} detail={detail} interactive={Boolean(to)} />
  if (!to) return body
  return (
    <Link
      to={to}
      search={search as never}
      className="no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {body}
    </Link>
  )
}

type SetupStep = { title: string; detail: string; done: boolean; optional?: boolean; action?: { label: string; to: '/dashboard/connect' | '/dashboard/posts/new' | '/dashboard/posts' | '/dashboard/theme' | '/dashboard/posts/$postId/edit'; params?: Record<string, string>; search?: Record<string, unknown> } }

/** First-run guide: shown until something is live, with real progress, not a static checklist. */
function GetStarted({ data, canEdit, onlyDraft }: { data: DashboardData; canEdit: boolean; onlyDraft?: { id: string; title: string } }) {
  // Site-specific evidence: a key for this blog has been used.
  const agentConnected = (data.usedTokenCount ?? 0) > 0
  const hasDraft = data.counts.draft + data.counts.published > 0
  const steps: SetupStep[] = [
    {
      title: 'Connect your agent',
      detail: agentConnected
        ? 'Your agent has reached vibecms.'
        : data.tokenCount > 0
          ? 'Your key is ready. Paste the command into your agent.'
          : 'Give your agent a key so it can write here.',
      done: agentConnected,
      action: agentConnected ? undefined : { label: 'Open Connect', to: '/dashboard/connect', search: emptyDashboardStatusSearch },
    },
    {
      title: 'Get a first draft',
      detail: hasDraft ? 'A draft is waiting.' : 'Ask your agent for a post, or write one yourself.',
      done: hasDraft,
      action: hasDraft ? undefined : { label: 'Write a post', to: '/dashboard/posts/new', search: emptyPostEditorSearch },
    },
    {
      title: 'Publish it',
      detail: onlyDraft ? `“${onlyDraft.title}” is ready to review. Nothing goes live until you publish.` : 'Review the draft, then publish. Nothing goes live until then.',
      done: data.counts.published > 0,
      // One draft waiting: go straight to it instead of a list of one.
      action: onlyDraft
        ? { label: 'Review draft', to: '/dashboard/posts/$postId/edit', params: { postId: onlyDraft.id }, search: emptyPostEditorSearch }
        : hasDraft ? { label: 'Review drafts', to: '/dashboard/posts', search: postsListSearch({ status: 'draft' }) } : undefined,
    },
    {
      title: 'Make it yours',
      detail: 'Pick a template, accent, and font. Change them any time.',
      done: false,
      optional: true,
      action: { label: 'Open Theme', to: '/dashboard/theme' },
    },
  ]
  // The first unfinished required step is the one to do next: give it the primary button.
  const nextIndex = steps.findIndex((step) => !step.done && !step.optional)
  return (
    <Section
      title="Get started"
      description="Three steps to a live blog your agents can write for."
      action={<span className="text-sm tabular-nums text-muted-foreground">{steps.filter((step) => step.done && !step.optional).length} of 3 done</span>}
    >
      <Steps>
        {steps.map((step, index) => (
          <Step
            key={step.title}
            n={index + 1}
            state={step.done ? 'done' : index === nextIndex ? 'current' : 'upcoming'}
            title={step.title}
            detail={step.detail}
            optional={step.optional}
            action={step.action && canEdit ? (
              <Button asChild variant={index === nextIndex ? 'default' : 'outline'} size="sm">
                <Link to={step.action.to} params={step.action.params as never} search={step.action.search as never}>{step.action.label}</Link>
              </Button>
            ) : undefined}
          />
        ))}
      </Steps>
    </Section>
  )
}

export function DashboardOverview({ canEdit }: { canEdit: boolean }) {
  const query = useQuery(overviewQuery)
  const me = useQuery(contextQuery).data?.app?.user
  const data = query.data ? narrowDashboardData(query.data) : null
  const error = query.isError && !query.data ? 'Could not load dashboard data.' : null

  if (error) {
    return <LoadError message={error} />
  }
  if (!data) {
    return <PageSkeleton variant="stats" />
  }

  const siteName = data.site?.name ?? BRAND.name
  const billingBadgeLabel = overviewEntitlementBadge(data.billing)
  const showBillingBadge = data.apiUsage.enforced && billingBadgeLabel !== null
  const isLive = Boolean(data.publicUrl) && !data.publicUrlLocal
  // Older API responses lack the review queue; fall back to agent-agnostic drafts.
  const reviewQueue = data.needsReview ?? data.recentDrafts.map((post) => ({
    ...post,
    versionNumber: null,
    publishedVersionNumber: null,
    latestActorType: null,
  }))
  const reviewCount = data.needsReviewCount ?? reviewQueue.length
  const images = `${data.media.count} ${data.media.count === 1 ? 'image' : 'images'}`
  // Until something is live, guide the owner instead of showing a wall of zeros.
  const firstRun = data.counts.published === 0
  // On a first run with a single draft, the guide links straight to it; don't list it three times.
  const onlyDraft = firstRun && reviewQueue.length === 1 && data.recentPosts.length <= 1
    ? { id: reviewQueue[0]!.id, title: reviewQueue[0]!.title }
    : undefined
  const entitled = data.billing.effective ?? data.billing.status === 'active'
  const freePlan = !entitled && data.apiUsage.enforced
  // The guide already covers "no posts yet" (or the single first draft); don't repeat it in a list.
  const showRecentPosts = !(firstRun && data.recentPosts.length <= 1)

  return (
    <>
      <PageHeader
        title={siteName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {data.publicUrl ? (
              <a
                className="min-w-0 [overflow-wrap:anywhere] font-mono text-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                href={data.publicUrl}
                target="_blank"
                rel="noreferrer"
              >
                {data.publicUrl.replace(/^https?:\/\//, '')}
              </a>
            ) : (
              <span>Your blog address appears once its domain is active.</span>
            )}
            <StatusBadge
              status={isLive ? 'live' : data.publicUrl ? 'none' : 'pending'}
              label={isLive ? 'Live' : data.publicUrl ? 'Local only' : 'Domain pending'}
            />
            {showBillingBadge && billingBadgeLabel ? (
              <StatusBadge status={billingBadgeLabel.toLowerCase().replaceAll(' ', '_')} label={billingBadgeLabel} />
            ) : null}
          </span>
        }
        action={canEdit ? (
          // During first run the guide's next step is the one primary action.
          <Button asChild variant={firstRun ? 'outline' : 'default'}>
            <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
              <Plus aria-hidden data-icon="inline-start" /> New post
            </Link>
          </Button>
        ) : undefined}
      />

      {firstRun ? <GetStarted data={data} canEdit={canEdit} onlyDraft={onlyDraft} /> : null}

      {firstRun ? null : <StatCardGrid className="xl:grid-cols-4">
        <Stat
          label="Published"
          value={data.counts.published}
          detail={data.counts.archived ? `${data.counts.archived} archived` : 'Live on your blog'}
          to="/dashboard/posts"
          search={postsListSearch({ status: 'published' })}
        />
        <Stat
          label="Needs review"
          value={reviewCount}
          detail={reviewCount ? 'Waiting on you' : 'Nothing waiting'}
          to="/dashboard/posts"
          search={postsListSearch({ status: 'review' })}
        />
        <Stat
          label="Subscribers"
          value={data.subscriberCount}
          detail="Signed up on your blog"
          to={canEdit ? '/dashboard/subscribers' : undefined}
          search={{ q: undefined, status: undefined, page: 1 }}
        />
        <Stat
          label="Media"
          value={formatBytes(data.media.bytes)}
          detail={data.billing.access === 'self_hosted' ? `${images} · Unlimited` : freePlan ? `${images} of ${FREE_TIER.images} images on the free plan` : `${images} of ${MEDIA.paidStorageLabel}`}
          to={canEdit ? '/dashboard/media' : undefined}
          search={emptyDashboardStatusSearch}
        />
      </StatCardGrid>}

      {reviewQueue.length > 0 && !onlyDraft ? (
        <Section
          title="Needs review"
          description="Agent drafts and live posts with unpublished changes."
          action={reviewCount > reviewQueue.length ? (
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard/posts" search={postsListSearch({ status: 'review' })}>View all {reviewCount}</Link>
            </Button>
          ) : undefined}
        >
          {/* The one bounded block on the page: the work that is waiting on you. */}
          <ul className="grid gap-0.5 rounded-xl border bg-card p-1.5">
            {reviewQueue.map((post) => (
              <li
                key={post.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent sm:grid-cols-[minmax(0,1fr)_auto_6rem_auto]"
              >
                <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                  {isAgentActor(post.latestActorType) ? (
                    <Bot aria-label="Written by an agent" className="size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                  <span className="min-w-0 break-words">{post.title}</span>
                </span>
                <ReviewBadge post={post} />
                <span className="hidden text-sm tabular-nums text-muted-foreground sm:block" title={formatDateTime(post.updatedAt)}>
                  {formatRelative(post.updatedAt)}
                </span>
                {canEdit ? (
                  <Button asChild variant="outline" size="sm" className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                    <Link {...postEditorLink(post.id)} search={emptyPostEditorSearch}>Review</Link>
                  </Button>
                ) : <span />}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className={showRecentPosts ? 'grid items-start gap-10 xl:grid-cols-2 xl:gap-12' : 'grid items-start'}>
        {showRecentPosts ? <Section
          title="Recent posts"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard/posts" search={emptyPostsListSearch}>All posts</Link>
            </Button>
          }
        >
          {data.recentPosts.length ? (
            <ul className="grid">
              {data.recentPosts.map((post) => (
                <li
                  key={post.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-x-3 border-b border-[color:var(--hairline)] py-3 last:border-b-0"
                >
                  {canEdit ? (
                    <Link
                      className="min-w-0 break-words font-medium text-foreground no-underline hover:underline"
                      {...postEditorLink(post.id)}
                      search={emptyPostEditorSearch}
                    >
                      {post.title}
                    </Link>
                  ) : <span className="min-w-0 break-words font-medium text-foreground">{post.title}</span>}
                  <StatusBadge status={post.status} className="w-fit" />
                  {post.scheduledPublish && ['pending', 'processing'].includes(post.scheduledPublish.status) ? <span className="text-xs text-warning">{scheduledLabel(post.scheduledPublish.publishAt)}</span> : null}
                  {post.scheduledPublish?.status === 'failed' ? <span className="text-xs text-destructive" title={post.scheduledPublish.error ?? undefined}>Schedule failed</span> : null}
                  <span className="text-right text-sm tabular-nums text-muted-foreground" title={formatDateTime(post.updatedAt)}>
                    {formatRelative(post.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<FileText />}
              title="No posts yet"
              description={
                canEdit
                  ? 'Connect an agent to draft your first post, or write one yourself.'
                  : 'No posts have been drafted or published for this blog yet.'
              }
              action={canEdit ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>
                      <Rocket aria-hidden data-icon="inline-start" /> Connect an agent
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
                      <Pencil aria-hidden data-icon="inline-start" /> Write a post
                    </Link>
                  </Button>
                </div>
              ) : undefined}
            />
          )}
        </Section> : null}

        <Section
          title="Recent activity"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard/activity">All activity</Link>
            </Button>
          }
        >
          {data.recentActivity.length ? (
            <ul className="grid">
              {data.recentActivity.map((event) => (
                <li
                  key={`${event.action}-${event.created_at}`}
                  className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-baseline gap-x-3 border-b border-[color:var(--hairline)] py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block break-words text-foreground">{activitySummary(event.action, event.summary)}</span>
                    <span className="block truncate text-sm text-muted-foreground">{isSystemActor(null, event.actor_name) ? 'vibecms' : personLabel(event.actor_name, me)}</span>
                  </span>
                  <span className="text-right text-sm tabular-nums text-muted-foreground" title={formatDateTime(event.created_at)}>
                    {formatRelative(event.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Activity />}
              title="No activity yet"
              description="Every change you or your agents make shows up here."
            />
          )}
        </Section>
      </div>

      <AgentUsage usage={data.apiUsage} tokenCount={data.tokenCount} canEdit={canEdit} paid={entitled} />
    </>
  )
}
