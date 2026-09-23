import { BRAND, MEDIA } from '@vc/config'
import { Activity, Bot, FileText, Pencil, Plus, Rocket, Users } from 'lucide-react'
import { isAgentActor, reviewLabel } from '~/lib/post-review'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { overviewQuery } from '~/lib/queries'
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
  labelAction,
} from '~/components/dashboard/DashboardLayout'
import { Badge, CopyButton } from '@vc/ui'
import {
  DataRow,
  EmptyState,
  MetricStrip,
  PageHeader,
  PageSkeleton,
  Panel,
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

function ApiUsagePanel({ usage }: { usage: DashboardData['apiUsage'] }) {
  if (!usage.enforced) {
    return (
      <Panel title="API and MCP usage" meta={<Badge variant="outline">Self-hosted</Badge>}>
        <p className="text-sm text-muted-foreground">Usage limits are not enforced in self-hosted mode.</p>
      </Panel>
    )
  }

  return (
    <Panel title="API and MCP usage">
      <MetricStrip
        variant="inset"
        metrics={[
          {
            label: 'Calls this month',
            value: usage.calls.month.used.toLocaleString(),
          },
          {
            label: 'Writes this month',
            value: usage.writes.month.used.toLocaleString(),
          },
        ]}
      />
    </Panel>
  )
}


export function DashboardOverview({ canEdit }: { canEdit: boolean }) {
  const query = useQuery(overviewQuery)
  const data = query.data ? narrowDashboardData(query.data) : null
  const error = query.isError && !query.data ? 'Could not load dashboard data.' : null

  if (error) {
    return <LoadError message={error} />
  }
  if (!data) {
    return <PageSkeleton variant="stats" />
  }

  const siteName = data.site?.name ?? BRAND.name
  const quotaLabel = MEDIA.paidStorageLabel
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

  return (
    <>
      <PageHeader
        title={siteName}
        description="Your publishing system: what is live, what changed, and where your agents can act."
        action={canEdit ? (
          <Button asChild>
            <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
              <Plus aria-hidden data-icon="inline-start" /> New post
            </Link>
          </Button>
        ) : undefined}
      />

      <Panel
        title="Blog status"
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={isLive ? 'live' : data.publicUrl ? 'none' : 'pending'}
              label={isLive ? 'Live' : data.publicUrl ? 'Local only' : 'Default domain pending'}
            />
            {showBillingBadge && billingBadgeLabel ? (
              <StatusBadge
                status={billingBadgeLabel.toLowerCase().replaceAll(' ', '_')}
                label={billingBadgeLabel}
              />
            ) : null}
          </div>
        }
      >
        {data.publicUrl ? (
          <a
            className="min-w-0 [overflow-wrap:anywhere] font-mono text-base font-medium text-primary underline-offset-4 hover:underline"
            href={data.publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            {data.publicUrl}
          </a>
        ) : (
          <p className="max-w-xl font-sans text-base leading-7 text-muted-foreground">
            Public blog URL appears once a deployable default domain is active.
          </p>
        )}
      </Panel>

      {reviewQueue.length > 0 ? (
        <Panel
          title="Needs review"
          meta={
            <Button asChild variant="link">
              <Link to="/dashboard/posts" search={postsListSearch({ status: 'review' })}>
                {reviewCount > reviewQueue.length ? `View all ${reviewCount}` : 'View all'}
              </Link>
            </Button>
          }
        >
          <div className="grid gap-0">
            {reviewQueue.map((post) => (
              <DataRow className="md:grid-cols-[1.5fr_.8fr_.6fr] md:items-center" key={post.id}>
                <strong className="flex min-w-0 items-center gap-2 font-display font-semibold text-foreground">
                  {isAgentActor(post.latestActorType) ? (
                    <Bot aria-label="Written by an agent" className="size-4 shrink-0 text-muted-foreground" />
                  ) : null}
                  {canEdit ? (
                    <Link
                      className="truncate no-underline hover:underline"
                      {...postEditorLink(post.id)}
                      search={emptyPostEditorSearch}
                    >
                      {post.title}
                    </Link>
                  ) : <span className="truncate">{post.title}</span>}
                </strong>
                <ReviewBadge post={post} />
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatDate(post.updatedAt)}
                </span>
              </DataRow>
            ))}
          </div>
        </Panel>
      ) : null}

      {data.activationPost && (
        <Panel title="Latest agent post">
          <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
                  {data.activationPost.title}
                </span>
                <span className="font-sans text-sm text-muted-foreground">
                  written by your agent · published by {data.activationPost.actorName}
                </span>
              </div>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDateTime(data.activationPost.publishedAt)}
              </p>
            </div>
            {data.activationPost.url ? (
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={data.activationPost.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-sans text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open article
                </a>
                <CopyButton
                  value={data.activationPost.url}
                  label="Copy link"
                  copiedLabel="Copied"
                  iconOnly
                />
              </div>
            ) : (
              <p className="font-sans text-sm text-muted-foreground">Public URL pending</p>
            )}
          </div>
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Recent activity"
          meta={
            <Button asChild variant="link">
              <Link to="/dashboard/activity">View all</Link>
            </Button>
          }
        >
          {data.recentActivity.length ? (
            <div className="grid gap-0">
              {data.recentActivity.map((event) => (
                <DataRow className="md:grid-cols-[1.4fr_.9fr_.7fr]" key={`${event.action}-${event.created_at}`}>
                  <strong className="min-w-0 break-words font-display font-semibold text-foreground line-clamp-2">{event.summary}</strong>
                  <span className="font-mono text-xs text-muted-foreground">
                    {labelAction(event.action)}
                  </span>
                  <span className="font-mono text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatDateTime(event.created_at)}
                  </span>
                </DataRow>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Activity />}
              title="No activity yet"
              description="Create a post, upload media, or issue an API token and this log fills in automatically."
            />
          )}
        </Panel>

        <Panel
          title="Recent posts"
          meta={
            <Button asChild variant="link">
              <Link to="/dashboard/posts" search={emptyPostsListSearch}>
                View all
              </Link>
            </Button>
          }
        >
          {data.recentPosts.length ? (
            <div className="grid gap-0">
              {data.recentPosts.map((post) => (
                <DataRow className="md:grid-cols-[1.5fr_.6fr_.8fr]" key={post.id}>
                  <strong className="truncate font-display font-semibold text-foreground">
                    {canEdit ? (
                    <Link
                      className="no-underline hover:underline"
                      {...postEditorLink(post.id)}
                      search={emptyPostEditorSearch}
                    >
                      {post.title}
                    </Link>
                    ) : post.title}
                  </strong>
                  <StatusBadge status={post.status} className="w-fit" />
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDate(post.updatedAt)}
                  </span>
                </DataRow>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<FileText />}
              title="No posts yet"
              description={
                canEdit
                  ? data.tokenCount > 0
                    ? 'Your agent access is ready. Open Connect to publish the first post through the approval-first flow, or start one manually.'
                    : 'Connect an agent to draft your first post through the approval-first flow, or start one manually.'
                  : 'No posts have been drafted or published for this site yet.'
              }
              action={canEdit ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>
                      <Rocket aria-hidden data-icon="inline-start" /> Publish with agent
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
                    <Pencil aria-hidden data-icon="inline-start" /> Write manually
                    </Link>
                  </Button>
                </div>
              ) : undefined}
            />
          )}
        </Panel>
      </div>

      <StatCardGrid>
        <Link
          to="/dashboard/posts"
          search={postsListSearch({ status: 'published' })}
          className="no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <StatCard label="Published" value={data.counts.published} detail={`${data.counts.archived} archived`} interactive />
        </Link>
        <Link
          to="/dashboard/posts"
          search={postsListSearch({ status: 'draft' })}
          className="no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <StatCard label="Drafts" value={data.counts.draft} detail={reviewCount > 0 ? `${reviewCount} waiting for review` : 'Nothing waiting'} interactive />
        </Link>
        {canEdit ? <Link
          to="/dashboard/media"
          search={emptyDashboardStatusSearch}
          className="no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <StatCard
            label="Media used"
            value={formatBytes(data.media.bytes)}
            detail={`${data.media.count} images of ${quotaLabel}`}
            interactive
          />
        </Link> : (
          <StatCard label="Media used" value={formatBytes(data.media.bytes)} detail={`${data.media.count} images of ${quotaLabel}`} />
        )}
        {canEdit ? <Link
          to="/dashboard/connect"
          search={emptyDashboardStatusSearch}
          className="no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <StatCard label="Active tokens" value={data.tokenCount} detail="Scoped for agents" interactive />
        </Link> : (
          <StatCard label="Active tokens" value={data.tokenCount} detail="Scoped for agents" />
        )}
        {canEdit ? (
          <Link
            to="/dashboard/subscribers"
            search={{ q: undefined, status: undefined, page: 1 }}
            className="no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:col-span-2 xl:col-span-1"
          >
            <StatCard
              label="Subscribers"
              value={data.subscriberCount}
              detail="Captured signups"
              icon={Users}
              interactive
            />
          </Link>
        ) : null}
      </StatCardGrid>

      <ApiUsagePanel usage={data.apiUsage} />
    </>
  )
}
