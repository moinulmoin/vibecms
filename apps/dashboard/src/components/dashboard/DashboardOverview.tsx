import { BRAND, MEDIA } from '@vc/config'
import { Activity, Bot, FileText, Pencil, Plus, Rocket } from 'lucide-react'
import { isAgentActor, reviewLabel } from '~/lib/post-review'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { contextQuery, overviewQuery } from '~/lib/queries'
import { personLabel } from '~/lib/people'
import type { DashboardData } from '~/types/dashboard'
import type { z } from 'zod'
import { dashboardDataSchema } from '~/lib/dashboard-response-schemas'

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

function AgentUsage({ usage, tokenCount, canEdit }: { usage: DashboardData['apiUsage']; tokenCount: number; canEdit: boolean }) {
  const keys = `${tokenCount} active ${tokenCount === 1 ? 'key' : 'keys'}`
  return (
    <Section
      title="Agent usage"
      description={
        usage.enforced
          ? `API and MCP requests this month. Resets ${formatDate(usage.calls.month.resetsAt)}.`
          : 'API and MCP requests are not limited on a self-hosted install.'
      }
      action={canEdit ? (
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>{keys}</Link>
        </Button>
      ) : <span className="text-sm text-muted-foreground">{keys}</span>}
    >
      {usage.enforced ? (
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
          <Button asChild>
            <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
              <Plus aria-hidden data-icon="inline-start" /> New post
            </Link>
          </Button>
        ) : undefined}
      />

      <StatCardGrid className="xl:grid-cols-4">
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
          detail={`${images} of ${MEDIA.paidStorageLabel}`}
          to={canEdit ? '/dashboard/media' : undefined}
          search={emptyDashboardStatusSearch}
        />
      </StatCardGrid>

      {reviewQueue.length > 0 ? (
        <Section
          title="Needs review"
          description="Agent drafts and live posts with unpublished changes."
          action={reviewCount > reviewQueue.length ? (
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard/posts" search={postsListSearch({ status: 'review' })}>View all {reviewCount}</Link>
            </Button>
          ) : undefined}
        >
          <ul className="grid">
            {reviewQueue.map((post) => (
              <li
                key={post.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-[color:var(--hairline)] py-3.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_6rem_auto]"
              >
                <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                  {isAgentActor(post.latestActorType) ? (
                    <Bot aria-label="Written by an agent" className="size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                  <span className="truncate">{post.title}</span>
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

      <div className="grid items-start gap-10 xl:grid-cols-2 xl:gap-12">
        <Section
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
                      className="truncate font-medium text-foreground no-underline hover:underline"
                      {...postEditorLink(post.id)}
                      search={emptyPostEditorSearch}
                    >
                      {post.title}
                    </Link>
                  ) : <span className="truncate font-medium text-foreground">{post.title}</span>}
                  <StatusBadge status={post.status} className="w-fit" />
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
        </Section>

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
                    <span className="block truncate text-foreground">{event.summary}</span>
                    <span className="block truncate text-sm text-muted-foreground">{personLabel(event.actor_name, me)}</span>
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

      <AgentUsage usage={data.apiUsage} tokenCount={data.tokenCount} canEdit={canEdit} />
    </>
  )
}
