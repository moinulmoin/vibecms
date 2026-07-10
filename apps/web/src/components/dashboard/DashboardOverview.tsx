import { BRAND, MEDIA } from '@vc/config'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { DashboardData } from '~/server/cms-dashboard'
import { loadDashboardOverview } from '~/server/dashboard-page-fn'
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
import { Badge } from "@vc/ui"
import { Card } from "@vc/ui"
import { Progress } from '~/components/ui/progress'
import { Skeleton } from "@vc/ui"
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

function UsageMeter({
  label,
  status,
}: {
  label: string
  status: DashboardData['apiUsage']['calls']['minute']
}) {
  const percent = status.limit > 0 ? Math.min(100, Math.round((status.used / status.limit) * 100)) : 0
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="font-mono text-xs tabular-nums text-foreground">
          {status.used}/{status.limit}
        </p>
      </div>
      <Progress
        value={percent}
        className="mt-2 h-1.5 [&_[data-slot=progress-indicator]]:bg-brand-bright"
      />
    </div>
  )
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
    <Panel title="API and MCP usage" meta={<Badge variant="outline">Workspace budget</Badge>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UsageMeter label="Calls / minute" status={usage.calls.minute} />
        <UsageMeter label="Calls / day" status={usage.calls.day} />
        <UsageMeter label="Writes / day" status={usage.writes.day} />
      </div>
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
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
        if (!cancelled) setData(result)
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
  const showSubscribeHint = data.apiUsage.enforced && data.billing.status !== 'active'
  const isLive = Boolean(data.publicUrl) && !data.publicUrlLocal

  return (
    <>
      <PageHeader
        kicker="Overview"
        title={siteName}
        description="Publishing status, media usage, agent access, and recent activity at a glance."
        action={
          <Button asChild>
            <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
              New post
            </Link>
          </Button>
        }
      />

      <Card className="gap-0 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="font-mono text-[11px] font-medium text-muted-foreground">
              Blog status
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {isLive ? (
                <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">
                  <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
                  Live
                </Badge>
              ) : (
                <Badge variant="outline">{data.publicUrl ? 'Local only' : 'Default domain pending'}</Badge>
              )}
              {showSubscribeHint ? <Badge variant="secondary">Subscribe to publish</Badge> : null}
            </div>
          </div>
          {data.publicUrl ? (
            <a
              className="break-all font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
              href={data.publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              {data.publicUrl}
            </a>
          ) : (
            <p className="font-sans text-sm text-muted-foreground">
              Public blog URL appears once a deployable default domain is active.
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link
          to="/dashboard/posts"
          search={postsListSearch({ status: 'published' })}
          className="rounded-2xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard label="Published" value={data.counts.published} detail={`${data.counts.archived} archived`} interactive />
        </Link>
        <Link
          to="/dashboard/posts"
          search={postsListSearch({ status: 'draft' })}
          className="rounded-2xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard label="Drafts" value={data.counts.draft} detail="Ready for review" interactive />
        </Link>
        <Link
          to="/dashboard/media"
          search={emptyDashboardStatusSearch}
          className="rounded-2xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="rounded-2xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard label="Active tokens" value={data.tokenCount} detail="Scoped for agents" interactive />
        </Link>
      </div>



      <div className="grid gap-4 xl:grid-cols-2">
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
            <div className="grid gap-2">
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
              title="No posts yet"
              description="Create the first post manually, then connect an agent token when you are ready for agents to help."
              action={
                <Button asChild>
                  <Link to="/dashboard/posts/new" search={emptyPostEditorSearch}>
                    New post
                  </Link>
                </Button>
              }
            />
          )}
        </Panel>

        <Panel
          title="Recent activity"
          meta={
            <Button asChild variant="link">
              <Link to="/dashboard/activity">View all</Link>
            </Button>
          }
        >
          {data.recentActivity.length ? (
            <div className="grid gap-2">
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
              title="No activity yet"
              description="Create a post, upload media, or issue an API token and this log fills in automatically."
            />
          )}
        </Panel>
      </div>

      <ApiUsagePanel usage={data.apiUsage} />
    </>
  )
}
