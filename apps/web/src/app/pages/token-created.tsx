import type { AppUserContext } from "@/server/onboarding";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, CopyButton } from "@vc/ui";
import { AppShell, PageHeader, Panel } from "./app-layout";
import { TokenCookieClearer } from "./token-cookie-clearer";

export function TokenCreated({ token, name, app }: { token: string; name: string; app: AppUserContext }) {
  return (
    <AppShell current="/app/settings" userEmail={app.user.email}>
      <TokenCookieClearer />
      <PageHeader kicker="Settings" title="Token Created" description="Copy this token now. It will not be shown again." action={<Button asChild variant="outline"><a href="/app/settings">Back to settings</a></Button>} />
      <Panel title="One-Time Token Reveal">
        <Card className="rounded-2xl border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-[-0.02em]">{name}</CardTitle>
            <CardDescription>This value is only shown from the short-lived secure handoff. Store it before leaving this page.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <pre className="overflow-auto rounded-lg border border-border bg-muted p-4 font-mono text-sm text-foreground">{token}</pre>
            <div className="flex flex-wrap items-center gap-3">
              <CopyButton value={token} label="Copy token" copiedLabel="Token copied" />
              <p className="text-sm text-muted-foreground">This token will not be shown again.</p>
            </div>
          </CardContent>
        </Card>
      </Panel>
    </AppShell>
  );
}
