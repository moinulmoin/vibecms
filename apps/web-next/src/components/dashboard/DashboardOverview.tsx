import { BRAND, MEDIA } from '@vc/config'
import { Badge } from '@vc/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { DashboardData } from '~/server/cms-dashboard'
import { loadDashboardOverview } from '~/server/dashboard-page-fn'
import {
  Button,
  DataRow,
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
  formatDate,
  formatDateTime,
  labelAction,
} from '~/components/dashboard/DashboardLayout'
import { emptyDashboardStatusSearch, emptyPostsListSearch } from '~/lib/dashboard-search'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`
  return `${(megabytes / 1024).toFixed(1)} GB`
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
    <div className="rounded-xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className="font-mono text-xs tabular-nums text-foreground">
          {status.used}/{status.limit}
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand-bright transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function ApiUsagePanel({ usage }: { usage: DashboardData['apiUsage'] }) {
  if (!usage.enforced) {
    return (
      <Panel title="API and MCP usage" meta="Self-hosted">
        <p className="text-sm text-muted-foreground">Usage limits are not enforced in self-hosted mode.</p>
      </Panel>
    )
  }

  return (
    <Panel title="API and MCP usage" meta="Workspace budget">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UsageMeter label="Calls / minute" status={usage.calls.minute} />
        <UsageMeter label="Calls / day" status={usage.calls.day} />
        <UsageMeter label="Writes / day" status={usage.writes.day} />
      </div>
    </Panel>
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
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (!data) {
    return <p className="font-mono text-sm text-muted-foreground">Loading workspace…</p>
  }

  const siteName = data.site?.name ?? BRAND.name
  const quotaLabel = MEDIA.paidStorageLabel
  const showSubscribeHint = data.apiUsage.enforced && data.billing.status !== 'active'

  return (
    <>
      <PageHeader
        kicker="Overview"
        title={siteName}
        description="At a glance: publishing status, media usage, agent access, recent edits, and audit activity."
        action={
          <Button asChild>
            <Link to="/app/posts" search={emptyPostsListSearch}>New post</Link>
          </Button>
        }
      />
      <div className="rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Blog status
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {data.publicUrl ? (data.publicUrlLocal ? 'Local only' : 'Live') : 'Default domain pending'}
              </Badge>
              {showSubscribeHint ? <Badge variant="secondary">Subscribe to publish</Badge> : null}
            </div>
          </div>
          {data.publicUrl ? (
            <a
              className="break-all font-mono text-sm font-medium text-brand-bright underline-offset-4 hover:underline"
              href={data.publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              {data.publicUrl}
            </a>
          ) : (
            <p className="font-sans text-sm text-muted-foreground">
              Public blog URL will appear after a deployable default domain is active.
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Published" value={data.counts.published} detail={`${data.counts.archived} archived`} />
        <StatCard label="Drafts" value={data.counts.draft} detail="Ready for review" />
        <StatCard
          label="Media used"
          value={formatBytes(data.media.bytes)}
          detail={`${data.media.count} images of ${quotaLabel}`}
        />
        <StatCard label="Active tokens" value={data.tokenCount} detail="Scoped for agents" />
        <StatCard label="Saved versions" value={data.versionCount} detail="Post history" />
      </div>
      <ApiUsagePanel usage={data.apiUsage} />
      <Panel title="Quick Actions" meta="Common tasks">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Button asChild>
            <Link to="/app/posts" search={emptyPostsListSearch}>New post</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/media" search={emptyDashboardStatusSearch}>Upload media</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/settings" search={emptyDashboardStatusSearch}>Create token</Link>
          </Button>
          {data.publicUrl ? (
            <Button asChild variant="outline">
              <a href={data.publicUrl} target="_blank" rel="noreferrer">
                View public blog
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              View public blog
            </Button>
          )}
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Recent Posts"
          meta={
            <Button asChild variant="link">
              <Link to="/app/posts" search={emptyPostsListSearch}>View all</Link>
            </Button>
          }
        >
          {data.recentPosts.length ? (
            <div className="grid gap-2">
              {data.recentPosts.map((post) => (
                <DataRow className="md:grid-cols-[1.5fr_.6fr_.8fr]" key={post.id}>
                  <strong className="font-display font-semibold text-foreground">
                    <Link className="no-underline hover:underline" to="/app/posts" search={emptyPostsListSearch}>
                      {post.title}
                    </Link>
                  </strong>
                  <Badge variant="outline" className="w-fit capitalize">
                    {post.status}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums">{formatDate(post.updatedAt)}</span>
                </DataRow>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No posts yet"
              description="Create the first post manually, then connect an agent token when you are ready for trusted agents to help."
              action={
                <Button asChild>
                  <Link to="/app/posts" search={emptyPostsListSearch}>New post</Link>
                </Button>
              }
            />
          )}
        </Panel>
        <Panel
          title="Recent Activity"
          meta={
            <Button asChild variant="link">
              <Link to="/app/activity">View all</Link>
            </Button>
          }
        >
          {data.recentActivity.length ? (
            <div className="grid gap-2">
              {data.recentActivity.map((event) => (
                <DataRow className="md:grid-cols-[1.4fr_.9fr_.7fr]" key={`${event.action}-${event.created_at}`}>
                  <strong className="font-display font-semibold text-foreground">{event.summary}</strong>
                  <span className="font-mono text-xs uppercase tracking-[0.06em] text-muted-foreground">
                    {labelAction(event.action)}
                  </span>
                  <span className="font-mono text-xs tabular-nums">{formatDateTime(event.created_at)}</span>
                </DataRow>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No activity yet"
              description="Create a post, upload media, or issue an API token and this log will fill in automatically."
            />
          )}
        </Panel>
      </div>
    </>
  )
}