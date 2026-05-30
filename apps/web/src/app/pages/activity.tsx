import { getActivity } from "@/server/cms";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel } from "./app-layout";

export const Activity = async ({ ctx }: { ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const events = await getActivity(ctx.app);
  return (
    <AppShell current="/app/activity" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Audit log" title="Activity" description="Every meaningful human, API, and agent action is logged here for trust and debugging." />
      <Panel title="Recent events" meta={`${events.length} shown`}>
          {events.length ? (
            <Table>
              <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={`${event.action}-${event.created_at}-${event.summary}`}>
                    <TableCell className="font-medium text-foreground">{event.summary}</TableCell>
                    <TableCell><Badge variant="outline">{event.action}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{event.actor_name}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(event.created_at * 1000).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <EmptyState title="No activity yet" description="Create a post, upload media, or issue an API token and this log will fill in automatically." />}
      </Panel>
    </AppShell>
  );
};
