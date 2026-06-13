import { BRAND, MEDIA, readFormStatus } from "@vc/config";
import { getDashboardData, type DashboardData } from "@/server/cms";
import { isSelfHosted } from "@/server/billing";
import type { AppUserContext } from "@/server/onboarding";
import { Badge } from "@vc/ui";
import { AppShell, Button, DataRow, EmptyState, PageHeader, Panel, StatCard, StatusAlert, formatDate, formatDateTime, labelAction } from "./app-layout";
import { LogoutButton } from "./logout-button";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

function UsageMeter({ label, status }: { label: string; status: DashboardData["apiUsage"]["calls"]["minute"] }) {
  const percent = status.limit > 0 ? Math.min(100, Math.round((status.used / status.limit) * 100)) : 0;
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">Resets {formatDateTime(status.resetsAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-foreground">{status.used.toLocaleString()} / {status.limit.toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted-foreground">{status.remaining.toLocaleString()} remaining</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ApiUsagePanel({ usage }: { usage: DashboardData["apiUsage"] }) {
  if (!usage.enforced) {
    return (
      <Panel title="API and MCP usage" meta="Hosted quotas">
        <div className="rounded-xl border border-border bg-muted/25 p-4">
          <p className="text-sm font-medium text-foreground">Hosted API quotas are not enforced for this workspace.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            MCP and REST share the same workspace budget when hosted quotas apply. Tokens are scoped access keys for agents and integrations, not separate subscriptions.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="API and MCP usage" meta="Workspace budget">
      <div className="grid gap-3 lg:grid-cols-2">
        <UsageMeter label="Minute calls" status={usage.calls.minute} />
        <UsageMeter label="Day calls" status={usage.calls.day} />
        <UsageMeter label="Month calls" status={usage.calls.month} />
        <UsageMeter label="Day writes" status={usage.writes.day} />
        <UsageMeter label="Month writes" status={usage.writes.month} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        MCP tools and REST requests share this hosted workspace budget. Tokens are scoped access keys for agents and integrations, not separate subscriptions.
      </p>
    </Panel>
  );
}

type DashboardProps = { request: Request; ctx: { app?: AppUserContext; authUrl?: string } };

export const Dashboard = async ({ request, ctx }: DashboardProps) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const { site, publicUrl, publicUrlLocal, billing, apiUsage, counts, media, tokenCount, versionCount, recentPosts, recentActivity } = await getDashboardData(ctx.app);
  const status = readFormStatus(new URL(request.url).searchParams);
  const siteName = site?.name ?? BRAND.name;
  const selfHosted = isSelfHosted();
  const quotaLabel = MEDIA.paidStorageLabel;
  const showSubscribeHint = !selfHosted && billing.status !== "active";

  return (
    <AppShell current="/app" siteName={siteName} userEmail={ctx.app.user.email}>
      <PageHeader
        kicker="Overview"
        title={siteName}
        description="At a glance: publishing status, media usage, agent access, recent edits, and audit activity."
        action={<><Button asChild><a href="/app/posts/new">New post</a></Button><LogoutButton authUrl={ctx.authUrl ?? "http://localhost:5173"} /></>}
      />
      <StatusAlert status={status} />
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Blog status</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{publicUrl ? (publicUrlLocal ? "Local only" : "Live") : "Default domain pending"}</Badge>
              {showSubscribeHint ? <Badge variant="secondary">Subscribe to publish</Badge> : null}
            </div>
          </div>
          {publicUrl ? (
            <a className="break-all text-sm font-medium text-foreground underline-offset-4 hover:underline" href={publicUrl} target="_blank" rel="noreferrer">
              {publicUrl}
            </a>
          ) : <p className="text-sm text-muted-foreground">Public blog URL will appear after a deployable default domain is active.</p>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Published" value={counts.published} detail={`${counts.archived} archived`} />
        <StatCard label="Drafts" value={counts.draft} detail="Ready for review" />
        <StatCard label="Media used" value={formatBytes(media.bytes)} detail={`${media.count} images of ${quotaLabel}`} />
        <StatCard label="Active tokens" value={tokenCount} detail="Scoped for agents" />
        <StatCard label="Saved versions" value={versionCount} detail="Post history" />
      </div>
      <ApiUsagePanel usage={apiUsage} />
      <Panel title="Quick Actions" meta="Common tasks">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Button asChild><a href="/app/posts/new">New post</a></Button>
          <Button asChild variant="outline"><a href="/app/media">Upload media</a></Button>
          <Button asChild variant="outline"><a href="/app/settings">Create token</a></Button>
          {publicUrl ? <Button asChild variant="outline"><a href={publicUrl} target="_blank" rel="noreferrer">View public blog</a></Button> : <Button variant="outline" disabled>View public blog</Button>}
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Recent Posts" meta={<Button asChild variant="link"><a href="/app/posts">View all</a></Button>}>
          {recentPosts.length ? (
            <div className="grid gap-2">
              {recentPosts.map((post) => (
                <DataRow className="md:grid-cols-[1.5fr_.6fr_.8fr]" key={post.id}>
                  <strong className="text-foreground"><a className="no-underline hover:underline" href={`/app/posts/${post.id}/edit`}>{post.title}</a></strong>
                  <Badge variant="outline" className="w-fit capitalize">{post.status}</Badge>
                  <span>{formatDate(post.updatedAt)}</span>
                </DataRow>
              ))}
            </div>
          ) : <EmptyState title="No posts yet" description="Create the first post manually, then connect an agent token when you are ready for trusted agents to help." action={<Button asChild><a href="/app/posts/new">New post</a></Button>} />}
        </Panel>
        <Panel title="Recent Activity" meta={<Button asChild variant="link"><a href="/app/activity">View all</a></Button>}>
          {recentActivity.length ? (
            <div className="grid gap-2">
              {recentActivity.map((event) => (
                <DataRow className="md:grid-cols-[1.4fr_.9fr_.7fr]" key={`${event.action}-${event.created_at}`}>
                  <strong className="text-foreground">{event.summary}</strong>
                  <span>{labelAction(event.action)}</span>
                  <span>{formatDateTime(event.created_at)}</span>
                </DataRow>
              ))}
            </div>
          ) : <EmptyState title="No activity yet" description="Create a post, upload media, or issue an API token and this log will fill in automatically." />}
        </Panel>
      </div>
    </AppShell>
  );
};
