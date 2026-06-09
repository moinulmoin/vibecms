import { DEFAULT_SCOPES } from "@vc/core";
import { BRAND } from "@vc/config";
import { readFormStatus } from "@vc/config";
import { getDashboardData } from "@/server/cms";
import type { AppUserContext } from "@/server/onboarding";
import { Badge } from "@vc/ui";
import { AppShell, Button, DataRow, EmptyState, PageHeader, Panel, StatCard, StatusAlert, formatDate, labelAction } from "./app-layout";
import { LogoutButton } from "./logout-button";

type DashboardProps = { request: Request; ctx: { app?: AppUserContext; authUrl?: string } };

export const Dashboard = async ({ request, ctx }: DashboardProps) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const { site, posts, activity, versionCount } = await getDashboardData(ctx.app);
  const status = readFormStatus(new URL(request.url).searchParams);

  return (
    <AppShell current="/app" siteName={site?.name ?? BRAND.name} userEmail={ctx.app.user.email}>
      <PageHeader
        kicker="Dashboard"
        title={site?.name ?? "Dashboard"}
        description="A single hosted blog with posts, media, version history, activity logs, and scoped MCP/API access for trusted agents."
        action={<><Button asChild><a href="/app/posts/new">New post</a></Button><LogoutButton authUrl={ctx.authUrl ?? "http://localhost:5173"} /></>}
      />
      <StatusAlert status={status} />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Public URL" value="Public blog" detail={site?.slug ? `/${site.slug}` : "Default hosted route pending"} />
        <StatCard label="Recent Posts" value={posts.length} detail="Latest content changes" />
        <StatCard label="Versions" value={versionCount} detail="Saved post snapshots" />
      </div>
      <Panel title="Recent Posts" meta={<Button asChild variant="link"><a href="/app/posts">View all</a></Button>}>
        {posts.length ? (
          <div className="grid gap-2">
            {posts.map((post) => (
              <DataRow className="md:grid-cols-[1.5fr_.6fr_.8fr_.7fr]" key={post.id}>
                <strong className="text-foreground"><a className="no-underline hover:underline" href={`/app/posts/${post.id}/edit`}>{post.title}</a></strong>
                <Badge variant="outline" className="w-fit capitalize">{post.status}</Badge>
                <span>{post.slug}</span>
                <span>{formatDate(post.updatedAt)}</span>
              </DataRow>
            ))}
          </div>
        ) : <EmptyState title="No posts yet" description="Create the first post manually, then use MCP/API tokens when you are ready to let agents help maintain the blog." action={<Button asChild><a href="/app/posts/new">New post</a></Button>} />}
      </Panel>
      <Panel title="Recent Activity" meta={`${DEFAULT_SCOPES.length} default API scopes`}>
        {activity.length ? (
          <div className="grid gap-2">
            {activity.map((event) => (
              <DataRow className="md:grid-cols-[1.5fr_.9fr_.7fr_.7fr]" key={`${event.action}-${event.created_at}`}>
                <strong className="text-foreground">{event.summary}</strong>
                <span>{labelAction(event.action)}</span>
                <span>{event.actor_name}</span>
                <span>{formatDate(event.created_at)}</span>
              </DataRow>
            ))}
          </div>
        ) : <EmptyState title="No activity yet" description="Create a post, upload media, or issue an API token and this log will fill in automatically." />}
      </Panel>
    </AppShell>
  );
};
