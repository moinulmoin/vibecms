import { DEFAULT_SCOPES } from "@vc/core";
import { getDashboardData } from "@/server/cms";
import type { AppUserContext } from "@/server/onboarding";
import { Badge } from "@vc/ui";
import { AppShell, Button, DataRow, EmptyState, PageHeader, Panel, StatCard } from "./app-layout";
import { LogoutButton } from "./logout-button";

function labelAction(action: string) {
  return action.replaceAll(".", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const Dashboard = async ({ ctx }: { ctx: { app?: AppUserContext; authUrl?: string } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const { site, posts, activity, versionCount } = await getDashboardData(ctx.app);

  return (
    <AppShell current="/app" siteName={site?.name ?? "VibeCMS"} userEmail={ctx.app.user.email}>
      <PageHeader
        kicker="Dashboard"
        title={site?.name ?? "Dashboard"}
        description="A single hosted blog with posts, media, version history, activity logs, and scoped MCP/API access for trusted agents."
        action={<><Button asChild><a href="/app/posts/new">Create post</a></Button><LogoutButton authUrl={ctx.authUrl ?? "http://localhost:5173"} /></>}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Public URL" value="Public blog" detail={site?.slug ? `/${site.slug}` : "Default hosted route pending"} />
        <StatCard label="Recent posts" value={posts.length} detail="latest content changes" />
        <StatCard label="Versions" value={versionCount} detail="saved post snapshots" />
      </div>
      <Panel title="Recent posts" meta={<Button asChild variant="link"><a href="/app/posts">View all</a></Button>}>
        {posts.length ? (
          <div className="grid gap-2">
            {posts.map((post) => (
              <DataRow className="md:grid-cols-[1.5fr_.6fr_.8fr_.7fr]" key={post.title}>
                <strong className="text-foreground"><a className="no-underline hover:underline" href={`/app/posts/${post.id}/edit`}>{post.title}</a></strong>
                <Badge variant="outline" className="w-fit">{post.status}</Badge>
                <span>{post.slug}</span>
                <span>{new Date(post.updatedAt * 1000).toLocaleDateString()}</span>
              </DataRow>
            ))}
          </div>
        ) : <EmptyState title="No posts yet" description="Create the first post manually, then use MCP/API tokens when you are ready to let agents help maintain the blog." action={<Button asChild><a href="/app/posts/new">Create first post</a></Button>} />}
      </Panel>
      <Panel title="Recent activity" meta={`${DEFAULT_SCOPES.length} default API scopes`}>
        <div className="grid gap-2">
          {activity.map((event) => (
            <DataRow className="md:grid-cols-[1.5fr_.9fr_.7fr_.7fr]" key={`${event.action}-${event.created_at}`}>
              <strong className="text-foreground">{event.summary}</strong>
              <span>{labelAction(event.action)}</span>
              <span>{event.actor_name}</span>
              <span>{new Date(event.created_at * 1000).toLocaleDateString()}</span>
            </DataRow>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
};
