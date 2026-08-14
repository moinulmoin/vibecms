import { BRAND, MEDIA } from '@vc/config'
import { ActivityLogIcon, FileTextIcon, Pencil2Icon, PlusIcon, RocketIcon } from '@radix-ui/react-icons'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
  return { ...result, recentPosts, recentDrafts }
}

import { loadDashboardOverview } from '~/lib/api-client'
import {
  Button,
  DataRow,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  StatCard,
  formatDate,
  formatDateTime,
  labelAction,
} from '~/components/dashboard/DashboardLayout'
import { Badge, CopyButton, Skeleton } from "@vc/ui"
import { MetricStrip, StatCardGrid, StatusBadge } from '~/components/dashboard/blocks'
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

function OverviewSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </>
  )
}

export function DashboardOverview() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadDashboardOverview()
      .then((result) => {
        if (!cancelled) setData(narrowDashboardData(result))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load dashboard data.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <LoadError message={error} />
  }
  if (!data) {
    return <OverviewSkeleton />
  }

  const siteName = data.site?.name ?? BRAND.name
  const quotaLabel = MEDIA.paidStorageLabel
  const billingBadgeLabel = overviewEntitlementBadge(data.billing)
  const showBillingBadge = data.apiUsage.enforced && billingBadgeLabel !== null
  const isLive = Boolean(data.publicUrl) && !data.publicUrlLocal

  return (
    <>
      <PageHeader
        title={siteName}
        description="Your publishing system: what is live, what changed, and where your agents can act."
        action={
          <Button asChild>
            <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
              <PlusIcon aria-hidden data-icon="inline-start" /> New post
            </Link>
          </Button>
        }
      />

      <Panel
        title="Blog status"
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {isLive ? (
              <StatusBadge status="live" />
            ) : (
              <Badge variant="outline">{data.publicUrl ? 'Local only' : 'Default domain pending'}</Badge>
            )}
            {showBillingBadge ? <Badge variant="secondary">{billingBadgeLabel}</Badge> : null}
          </div>
        }
      >
        {data.publicUrl ? (
          <a
            className="break-all font-mono text-base font-medium text-primary underline-offset-4 hover:underline"
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

      {data.recentDrafts.length > 0 ? (
        <Panel
          title="Needs review"
          meta={
            <Button asChild variant="link">
              <Link to="/dashboard/posts" search={postsListSearch({ status: 'draft' })}>
                View all drafts
              </Link>
            </Button>
          }
        >
          <div className="grid gap-0">
            {data.recentDrafts.map((post) => (
              <DataRow className="md:grid-cols-[1.5fr_.6fr_.8fr]" key={post.id}>
                <strong className="truncate font-display font-semibold text-foreground">
                  <Link
                    className="no-underline hover:underline"
                    {...postEditorLink(post.id)}
                    search={emptyPostEditorSearch}
                  >
                    {post.title}
                  </Link>
                </strong>
                <Badge variant="outline" className="w-fit capitalize">
                  {post.status}
                </Badge>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatDate(post.updatedAt)}
                </span>
              </DataRow>
            ))}
          </div>
        </Panel>
      ) : null}

      {data.activationPost && (
        <Panel title="Latest agent publish">
          <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
                  {data.activationPost.title}
                </span>
                <span className="font-sans text-sm text-muted-foreground">
                  by {data.activationPost.actorName}
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

      <div className="grid gap-4 xl:grid-cols-2">
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
                  <strong className="truncate font-display font-semibold text-foreground">{event.summary}</strong>
                  <span className="font-mono text-xs text-muted-foreground">
                    {labelAction(event.action)}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(event.created_at)}
                  </span>
                </DataRow>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ActivityLogIcon />}
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
                    <Link
                      className="no-underline hover:underline"
                      {...postEditorLink(post.id)}
                      search={emptyPostEditorSearch}
                    >
                      {post.title}
                    </Link>
                  </strong>
                  <Badge variant="outline" className="w-fit capitalize">
                    {post.status}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDate(post.updatedAt)}
                  </span>
                </DataRow>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<FileTextIcon />}
              title="No posts yet"
              description={
                data.tokenCount > 0
                  ? 'Your agent access is ready. Open Connect to publish the first post through the approval-first flow, or start one manually.'
                  : 'Connect an agent to draft your first post through the approval-first flow, or start one manually.'
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>
                      <RocketIcon aria-hidden data-icon="inline-start" /> Publish with agent
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
                      <Pencil2Icon aria-hidden data-icon="inline-start" /> Write manually
                    </Link>
                  </Button>
                </div>
              }
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
          <StatCard label="Drafts" value={data.counts.draft} detail="Ready for review" interactive />
        </Link>
        <Link
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
        </Link>
        <Link
          to="/dashboard/connect"
          search={emptyDashboardStatusSearch}
          className="no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <StatCard label="Active tokens" value={data.tokenCount} detail="Scoped for agents" interactive />
        </Link>
      </StatCardGrid>

      <ApiUsagePanel usage={data.apiUsage} />
    </>
  )
}
