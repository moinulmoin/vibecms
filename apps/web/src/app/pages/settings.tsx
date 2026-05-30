import { DEFAULT_SCOPES } from "@vc/core";
import { allScopes, listApiKeys } from "@/server/api-keys";
import { getBilling, isSelfHosted } from "@/server/billing";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Button, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel } from "./app-layout";

const scopeCopy: Record<string, { label: string; description: string; risk?: string }> = {
  "sites:read": { label: "Read site", description: "View blog metadata and default domain." },
  "posts:read": { label: "Read posts", description: "List and inspect posts and drafts." },
  "posts:create": { label: "Create drafts", description: "Create new unpublished posts." },
  "posts:update": { label: "Update drafts", description: "Edit post title, slug, markdown, tags, and cover." },
  "posts:publish": { label: "Publish live", description: "Push content to the public blog.", risk: "high risk" },
  "posts:archive": { label: "Archive posts", description: "Hide posts while keeping versions and history." },
  "assets:write": { label: "Upload images", description: "Upload allowed blog media to the library." },
  "activity:read": { label: "Read audit log", description: "Review human/API/agent activity history." },
};

export const Settings = async ({ ctx }: { ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const apiKeys = await listApiKeys(ctx.app);
  const billing = await getBilling(ctx.app.workspaceId);
  const selfHosted = isSelfHosted();
  const isOwner = ctx.app.actor.type === "human" && ctx.app.actor.role === "owner";
  return (
    <AppShell current="/app/settings" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Settings" title="Workspace settings" description="Manage billing and the scoped credentials agents use to safely operate the blog." />
      <Panel title="Billing" meta={<Badge variant="outline">{selfHosted ? "self-hosted" : billing?.status ?? "none"}</Badge>}>
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">{selfHosted ? "Billing disabled for this self-hosted workspace" : "$9/month or $99/year · 7-day card-required trial"}</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {selfHosted ? "Publishing, media uploads, MCP/API access, activity history, and post versions run on your own Cloudflare resources without Polar checkout." : "Publishing and media uploads are allowed while billing is trialing or active. Trial media is capped at 500MB and paid media at 5GB."}
              </p>
            </div>
          {selfHosted ? <Badge variant="outline" className="w-fit lg:justify-self-end">SELF_HOSTED=true</Badge> : isOwner ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <form method="post" action="/app/billing/checkout"><Button name="interval" value="monthly" type="submit">Start monthly checkout</Button></form>
              <form method="post" action="/app/billing/checkout"><Button name="interval" value="yearly" variant="outline" type="submit">Start yearly checkout</Button></form>
              <form method="post" action="/app/billing/portal"><Button variant="outline" type="submit">Customer portal</Button></form>
            </div>
          ) : <p className="mt-4 text-sm text-muted-foreground">Only workspace owners can manage billing.</p>}
          </div>
      </Panel>
      <Panel title="Agent access token" meta="Default excludes publish">
          <form className="grid max-w-3xl gap-4" method="post" action="/app/settings/api-keys/create">
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-2 text-muted-foreground">Token name<Input name="name" required defaultValue="Local agent" /></Label>
              <Label className="grid gap-2 text-muted-foreground">Actor name<Input name="actorName" required defaultValue="Local agent" /></Label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {allScopes.map((scope) => (
                <Label key={scope} className="flex gap-3 rounded-xl border bg-background p-3 text-foreground hover:bg-muted/40">
                  <input className="mt-1" type="checkbox" name="scopes" value={scope} defaultChecked={DEFAULT_SCOPES.includes(scope)} />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium">{scopeCopy[scope]?.label ?? scope}{scopeCopy[scope]?.risk ? <Badge variant="destructive" className="text-[0.65rem] uppercase">{scopeCopy[scope]?.risk}</Badge> : null}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{scopeCopy[scope]?.description ?? scope}</span>
                  </span>
                </Label>
              ))}
            </div>
            <Button className="w-fit" type="submit">Create token</Button>
          </form>
      </Panel>
      <Panel title="Existing tokens" meta={`${apiKeys.length} total`}>
          {apiKeys.length ? (
            <Table>
              <TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Status</TableHead><TableHead>Last used</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell><strong className="text-foreground">{key.name}</strong><p className="mt-1 max-w-2xl truncate text-xs text-muted-foreground">{key.tokenPrefix}… · {key.scopes.join(", ")}</p></TableCell>
                    <TableCell><Badge variant={key.revokedAt ? "secondary" : "outline"}>{key.revokedAt ? "revoked" : "active"}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{key.lastUsedAt ? new Date(key.lastUsedAt * 1000).toLocaleDateString() : "never used"}</TableCell>
                    <TableCell className="text-right">{!key.revokedAt ? <form method="post" action={`/app/settings/api-keys/${key.id}/revoke`}><Button size="sm" variant="outline" type="submit">Revoke</Button></form> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : <EmptyState title="No tokens yet" description="Create a token when you are ready to connect an agent through the MCP/API surface." />}
      </Panel>
    </AppShell>
  );
};
