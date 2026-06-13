import { DEFAULT_SCOPES } from "@vc/core";
import { BRAND, ENTITLEMENTS, MEDIA, PRICING, readFormStatus } from "@vc/config";
import { allScopes, canManageApiKeys, listApiKeys } from "@/server/api-keys";
import { getBilling, isSelfHosted } from "@/server/billing";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Button, ConfirmSubmit, CopyButton, Field, FieldDescription, FieldLabel, FieldLegend, FieldSet, Input, SubmitButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel, StatusAlert, formatDate } from "./app-layout";

const scopeCopy: Record<string, { label: string; description: string; risk?: string }> = {
  "sites:read": { label: "Read Site", description: "View blog metadata and default domain." },
  "posts:read": { label: "Read Posts", description: "List and inspect posts and drafts." },
  "posts:create": { label: "Create Drafts", description: "Create new unpublished posts." },
  "posts:update": { label: "Update Drafts", description: "Edit post title, slug, markdown, tags, and cover." },
  "posts:publish": { label: "Publish", description: "Push content to the public blog.", risk: "high risk" },
  "posts:archive": { label: "Archive Posts", description: "Hide posts while keeping versions and history." },
  "assets:write": { label: "Upload Images", description: "Upload allowed blog media to the library." },
  "activity:read": { label: "Read Audit Log", description: "Review human and agent activity history." },
};

export const Settings = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const billing = await getBilling(ctx.app.workspaceId);
  const selfHosted = isSelfHosted();
  const isOwner = ctx.app.actor.type === "human" && ctx.app.actor.role === "owner";
  const canManageTokens = canManageApiKeys(ctx.app);
  const canUseBillableFeatures = selfHosted || billing?.status === "active";
  const canCreateTokens = canManageTokens && canUseBillableFeatures;
  const apiKeys = await listApiKeys(ctx.app);
  const status = readFormStatus(new URL(request.url).searchParams);
  const origin = new URL(request.url).origin;
  const mcpUrl = `${origin}/mcp`;
  const httpClientExample = `{
  "mcpServers": {
    "vibecms": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer vc_..."
      }
    }
  }
}`;
  const mcpListExample = `curl ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer vc_..." \\
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;
  const mcpCreateExample = `curl ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer vc_..." \\
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"posts.create","arguments":{"title":"Shipping week 23","slug":"shipping-week-23","contentMarkdown":"## What shipped"}}}'`;
  const restExample = `curl "${origin}/api/posts?limit=20&offset=0" \\
  -H "Authorization: Bearer vc_..."`;
  return (
    <AppShell current="/app/settings" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Settings" title="Workspace Settings" description="Manage billing and the scoped credentials agents use to safely operate the blog." />
      <StatusAlert status={status} />
      <Panel title="Billing" meta={<Badge variant="outline">{selfHosted ? "self-hosted" : billing?.status ?? "none"}</Badge>}>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-medium text-foreground">{selfHosted ? "Billing is disabled for this self-hosted workspace" : `${PRICING.planName}: ${PRICING.monthlyLabel} or ${PRICING.annualLabel}`}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {selfHosted ? "Publishing, media uploads, scoped agent access, activity history, and post versions run on your own Cloudflare resources without Polar checkout." : `Media storage is capped at ${MEDIA.paidStorageLabel}. Subscribe to publish, upload media, and create agent tokens.`}
            </p>
          </div>
          {selfHosted ? <Badge variant="outline" className="w-fit lg:justify-self-end">SELF_HOSTED=true</Badge> : isOwner ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <form method="post" action="/app/billing/checkout"><SubmitButton name="interval" value="monthly" pendingText="Starting checkout…">Subscribe monthly</SubmitButton></form>
              <form method="post" action="/app/billing/checkout"><SubmitButton name="interval" value="yearly" variant="outline" pendingText="Starting checkout…">Subscribe yearly</SubmitButton></form>
              <form method="post" action="/app/billing/portal"><SubmitButton variant="outline" pendingText="Opening portal…">Customer portal</SubmitButton></form>
            </div>
          ) : <p className="mt-4 text-sm text-muted-foreground">Only workspace owners can manage billing.</p>}
        </div>
      </Panel>
      <Panel title="Agent Access Token" meta={canCreateTokens ? "Default excludes Publish" : canManageTokens ? "Billing required to create new tokens" : "Owner access required"}>
        {canCreateTokens ? (
          <form className="grid max-w-3xl gap-4" method="post" action="/app/settings/api-keys/create">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="token-name">Token Name</FieldLabel>
                <Input id="token-name" name="name" required defaultValue="Local agent" />
              </Field>
              <Field>
                <FieldLabel htmlFor="token-actor-name">Actor Name</FieldLabel>
                <Input id="token-actor-name" name="actorName" required defaultValue="Local agent" />
                <FieldDescription>Shown in activity when this token changes content.</FieldDescription>
              </Field>
            </div>
            <FieldSet className="gap-3">
              <FieldLegend>Token Scopes</FieldLegend>
              <div className="grid gap-2 md:grid-cols-2">
                {allScopes.map((scope) => (
                  <Field key={scope} orientation="horizontal" className="rounded-xl border border-border bg-background p-3 text-foreground hover:bg-muted/40">
                    <input id={`scope-${scope.replace(":", "-")}`} className="mt-1" type="checkbox" name="scopes" value={scope} defaultChecked={DEFAULT_SCOPES.includes(scope)} />
                    <span>
                      <FieldLabel htmlFor={`scope-${scope.replace(":", "-")}`} className="flex items-center gap-2 text-sm font-medium">{scopeCopy[scope]?.label ?? scope}{scopeCopy[scope]?.risk ? <Badge variant="destructive" className="text-[0.65rem] uppercase">{scopeCopy[scope]?.risk}</Badge> : null}</FieldLabel>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{scopeCopy[scope]?.description ?? scope}</span>
                    </span>
                  </Field>
                ))}
              </div>
            </FieldSet>
            <SubmitButton className="w-fit" pendingText="Creating token…">Create token</SubmitButton>
          </form>
        ) : canManageTokens ? <p className="text-sm text-muted-foreground">Subscribe to create new agent access tokens. Existing tokens can still be revoked below.</p> : <p className="text-sm text-muted-foreground">Only workspace owners can create agent access tokens.</p>}
      </Panel>
      <Panel title="Existing Tokens" meta={`${apiKeys.length} total`}>
        {apiKeys.length ? (
          <>
            <div className="grid gap-3 md:hidden">
              {apiKeys.map((key) => (
                <article className="grid gap-3 rounded-xl border border-border bg-background p-4" key={key.id}>
                  <div className="min-w-0">
                    <strong className="text-foreground">{key.name}</strong>
                    <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{key.tokenPrefix}… · {key.scopes.join(", ")}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={key.revokedAt ? "secondary" : "outline"}>{key.revokedAt ? "revoked" : "active"}</Badge>
                    <span>Last used {key.lastUsedAt ? formatDate(key.lastUsedAt) : "never"}</span>
                  </div>
                  {!key.revokedAt ? <form method="post" action={`/app/settings/api-keys/${key.id}/revoke`}><ConfirmSubmit size="sm" confirmLabel="Confirm revoke" helperText="Revoking immediately blocks this token.">Revoke</ConfirmSubmit></form> : null}
                </article>
              ))}
            </div>
            <Table className="hidden md:table">
              <TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Status</TableHead><TableHead>Last Used</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell><strong className="text-foreground">{key.name}</strong><p className="mt-1 max-w-2xl truncate text-xs text-muted-foreground">{key.tokenPrefix}… · {key.scopes.join(", ")}</p></TableCell>
                    <TableCell><Badge variant={key.revokedAt ? "secondary" : "outline"}>{key.revokedAt ? "revoked" : "active"}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{key.lastUsedAt ? formatDate(key.lastUsedAt) : "never used"}</TableCell>
                    <TableCell className="text-right">{!key.revokedAt ? <form method="post" action={`/app/settings/api-keys/${key.id}/revoke`}><ConfirmSubmit size="sm" confirmLabel="Confirm revoke" helperText="Revoking immediately blocks this token.">Revoke</ConfirmSubmit></form> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : <EmptyState title="No tokens yet" description={`Create a token when you are ready to connect an agent through ${BRAND.name}.`} />}
      </Panel>
      <Panel title="Connect an agent" meta="HTTPS MCP + REST reads">
        <div className="grid gap-5 text-sm">
          <p className="text-muted-foreground">Agents connect over normal HTTPS. Give them the MCP endpoint plus a scoped token in the <code className="font-mono text-foreground">Authorization</code> header. REST stays read/list only.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>MCP endpoint</FieldLabel>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">{mcpUrl}</code>
                <CopyButton value={mcpUrl} />
              </div>
              <FieldDescription>Use this URL for remote HTTP MCP clients.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Authorization header</FieldLabel>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">Authorization: Bearer vc_...</code>
                <CopyButton value="Authorization: Bearer vc_..." />
              </div>
              <FieldDescription>Tokens are shown once when created. Revoke them anytime.</FieldDescription>
            </Field>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Remote HTTP MCP config</FieldLabel>
              <CopyButton value={httpClientExample} />
            </div>
            <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">{httpClientExample}</pre>
            <p className="text-xs leading-5 text-muted-foreground">Use this shape for clients that support remote HTTP MCP with custom headers. Client key names may vary.</p>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Verify tools/list</FieldLabel>
              <CopyButton value={mcpListExample} />
            </div>
            <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">{mcpListExample}</pre>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Create a draft through MCP</FieldLabel>
              <CopyButton value={mcpCreateExample} />
            </div>
            <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">{mcpCreateExample}</pre>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>List posts (REST)</FieldLabel>
              <CopyButton value={restExample} />
            </div>
            <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">{restExample}</pre>
          </div>
          <div className="grid gap-2">
            <p className="font-medium text-foreground">Scopes</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(scopeCopy).map(([scope, copy]) => (
                <div key={scope} className="grid min-w-0 gap-2 rounded-lg border border-border bg-background p-3 sm:flex sm:items-start">
                  <code className="font-mono text-xs text-foreground">{scope}</code>
                  <span className="text-xs leading-5 text-muted-foreground">{copy.description}{copy.risk ? <span className="ml-1 font-medium text-destructive">({copy.risk})</span> : null}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
      {isOwner ? (
        <Panel title="Your data" meta="Export">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Download every post (drafts, published, and archived) as JSON. Your content is yours to keep, with no lock-in.</p>
            <Button asChild variant="outline"><a href="/app/export.json">Export posts</a></Button>
          </div>
        </Panel>
      ) : null}
      <Panel title="Plan Includes" meta={PRICING.planName}>
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
          {ENTITLEMENTS.map((entitlement) => <span className="rounded-xl border border-border bg-background p-3" key={entitlement}>{entitlement}</span>)}
        </div>
      </Panel>
    </AppShell>
  );
};
