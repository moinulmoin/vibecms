import { readFormStatus } from "@vc/config";
import { canManageApiKeys } from "@/server/api-keys";
import type { AppUserContext } from "@/server/onboarding";
import { Button, SubmitButton } from "@vc/ui";
import { AppShell, PageHeader, Panel, StatusAlert } from "./app-layout";
import { ConnectAgent } from "./connect-agent";

export function Connect({ app, request, mcpUrl, token, tokenName }: { app: AppUserContext; request: Request; mcpUrl: string; token?: string; tokenName?: string }) {
  const status = readFormStatus(new URL(request.url).searchParams);
  const canManage = canManageApiKeys(app);
  const justCreated = Boolean(token);

  return (
    <AppShell current="/app/connect" userEmail={app.user.email}>
      <PageHeader
        kicker="Connect"
        title={justCreated ? "Your agent is ready" : "Connect your agent"}
        description={
          justCreated
            ? "Copy the token and config below, then paste the starter prompt into your agent."
            : "Generate a scoped token and point your AI agent at the blog over MCP. It can draft right away - publishing turns on when you subscribe."
        }
        action={<Button asChild><a href="/app">Open dashboard</a></Button>}
      />
      <div className="grid gap-4">
        <StatusAlert status={status} />
        {!justCreated ? (
          canManage ? (
            <Panel title="1. Create an agent token" meta="Draft-only">
              <div className="grid gap-3">
                <p className="font-sans text-sm leading-6 text-muted-foreground">Starts as a safe draft-only assistant. You can let it publish later from Settings.</p>
                <form method="post" action="/app/settings/api-keys/create?flow=connect" className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="name" value="My agent" />
                  <input type="hidden" name="actorName" value="My agent" />
                  <input type="hidden" name="preset" value="draft" />
                  <SubmitButton pendingText="Creating token…">Generate agent token</SubmitButton>
                  <span className="font-mono text-xs text-muted-foreground">Shown once - keep it somewhere safe.</span>
                </form>
              </div>
            </Panel>
          ) : (
            <Panel title="Create an agent token">
              <p className="font-sans text-sm leading-6 text-muted-foreground">Only the workspace owner can create agent tokens. Ask the owner to connect an agent.</p>
            </Panel>
          )
        ) : null}
        <Panel title={justCreated ? "Connect and start" : "2. Connect your agent"}>
          <ConnectAgent mcpUrl={mcpUrl} token={token} tokenName={tokenName} />
        </Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
          <p className="font-sans text-sm leading-6 text-muted-foreground">You can revisit this and manage tokens anytime in Settings.</p>
          <Button asChild variant="outline"><a href="/app">{justCreated ? "Go to dashboard" : "Skip for now"}</a></Button>
        </div>
      </div>
    </AppShell>
  );
}
