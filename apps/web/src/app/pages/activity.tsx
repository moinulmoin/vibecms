import { getActivity } from "@/server/cms";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel, formatDateTime, labelAction } from "./app-layout";

export const Activity = async ({ ctx }: { ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const events = await getActivity(ctx.app);
  return (
    <AppShell current="/app/activity" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Audit Log" title="Activity" description="Every meaningful human, API, and agent action is logged here for trust and debugging." />
      <Panel title="Recent Events" meta={`${events.length} shown`}>
        {events.length ? (
          <>
            <div className="grid gap-3 md:hidden">
              {events.map((event) => (
                <article className="grid gap-3 rounded-xl border border-border bg-background p-4" key={`${event.action}-${event.created_at}-${event.summary}`}>
                  <p className="font-medium leading-6 text-foreground">{event.summary}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{labelAction(event.action)}</Badge>
                    <span className="text-xs text-muted-foreground">{event.actor_name}</span>
                  </div>
                  <time className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</time>
                </article>
              ))}
            </div>
            <Table className="hidden md:table">
              <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={`${event.action}-${event.created_at}-${event.summary}`}>
                    <TableCell className="font-medium text-foreground">{event.summary}</TableCell>
                    <TableCell><Badge variant="outline">{labelAction(event.action)}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{event.actor_name}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(event.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : <EmptyState title="No activity yet" description="Create a post, upload media, or issue an API token and this log will fill in automatically." />}
      </Panel>
    </AppShell>
  );
};
