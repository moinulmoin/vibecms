import type { AppUserContext } from "@/server/onboarding";
import { Button } from "@vc/ui";
import { AppShell, PageHeader, Panel } from "./app-layout";
import { ConnectAgent } from "./connect-agent";

export function TokenCreated({ token, name, mcpUrl, app }: { token: string; name: string; mcpUrl: string; app: AppUserContext }) {
  return (
    <AppShell current="/app/settings" userEmail={app.user.email}>
      <PageHeader
        kicker="Settings"
        title="Token created"
        description="Copy this token now - it is shown only once - then drop the config into your agent."
        action={<Button asChild variant="outline"><a href="/app/settings">Back to settings</a></Button>}
      />
      <Panel title="Connect your agent">
        <ConnectAgent mcpUrl={mcpUrl} token={token} tokenName={name} />
      </Panel>
    </AppShell>
  );
}
