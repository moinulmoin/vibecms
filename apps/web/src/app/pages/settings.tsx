import { DEFAULT_SCOPES } from "@vc/core";
import { BRAND, ENTITLEMENTS, MEDIA, PRICING, THEMES, readFormStatus } from "@vc/config";
import { allScopes, listApiKeys } from "@/server/api-keys";
import { getBilling, isSelfHosted } from "@/server/billing";
import { getSiteSetup, type AppUserContext } from "@/server/onboarding";
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
  "activity:read": { label: "Read Audit Log", description: "Review human/API/agent activity history." },
};

export const Settings = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const apiKeys = await listApiKeys(ctx.app);
  const billing = await getBilling(ctx.app.workspaceId);
  const selfHosted = isSelfHosted();
  const isOwner = ctx.app.actor.type === "human" && ctx.app.actor.role === "owner";
  const status = readFormStatus(new URL(request.url).searchParams);
  const { theme } = await getSiteSetup(ctx.app);
  const origin = new URL(request.url).origin;
  const mcpExample = `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "posts.create",
    "arguments": { "title": "Shipping week 23", "slug": "shipping-week-23", "contentMarkdown": "## What shipped" }
  }
}`;
  const restExample = `curl -H "Authorization: Bearer vc_..." ${origin}/api/posts`;
  return (
    <AppShell current="/app/settings" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Settings" title="Workspace Settings" description="Manage billing and the scoped credentials agents use to safely operate the blog." />
      <StatusAlert status={status} />
      <Panel title="Billing" meta={<Badge variant="outline">{selfHosted ? "self-hosted" : billing?.status ?? "none"}</Badge>}>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-medium text-foreground">{selfHosted ? "Billing is disabled for this self-hosted workspace" : `${PRICING.planName}: ${PRICING.monthlyLabel} or ${PRICING.annualLabel}`}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {selfHosted ? "Publishing, media uploads, MCP/API access, activity history, and post versions run on your own Cloudflare resources without Polar checkout." : `${PRICING.trialLabel}. Trial media is capped at ${MEDIA.trialStorageLabel}; paid media is capped at ${MEDIA.paidStorageLabel}.`}
            </p>
          </div>
          {selfHosted ? <Badge variant="outline" className="w-fit lg:justify-self-end">SELF_HOSTED=true</Badge> : isOwner ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <form method="post" action="/app/billing/checkout"><SubmitButton name="interval" value="monthly" pendingText="Starting checkout…">Start monthly trial</SubmitButton></form>
              <form method="post" action="/app/billing/checkout"><SubmitButton name="interval" value="yearly" variant="outline" pendingText="Starting checkout…">Start yearly trial</SubmitButton></form>
              <form method="post" action="/app/billing/portal"><SubmitButton variant="outline" pendingText="Opening portal…">Customer portal</SubmitButton></form>
            </div>
          ) : <p className="mt-4 text-sm text-muted-foreground">Only workspace owners can manage billing.</p>}
        </div>
      </Panel>
      <Panel title="Appearance" meta="Public blog theme">
        <form className="grid gap-4" method="post" action="/app/settings/appearance">
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="sr-only">Public blog theme</legend>
            {THEMES.map((option) => (
              <label key={option.id} className="flex cursor-pointer flex-col gap-1 rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-accent">
                <span className="flex items-center gap-2">
                  <input type="radio" name="theme" value={option.id} defaultChecked={option.id === theme} className="size-4 accent-primary" />
                  <span className="font-medium text-foreground">{option.label}</span>
                </span>
                <span className="text-sm text-muted-foreground">{option.description}</span>
              </label>
            ))}
          </fieldset>
          <div><SubmitButton variant="outline" pendingText={"Saving theme\u2026"}>Save theme</SubmitButton></div>
        </form>
      </Panel>
      <Panel title="Agent Access Token" meta="Default excludes Publish">
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
      </Panel>
      <Panel title="Existing Tokens" meta={`${apiKeys.length} total`}>
        {apiKeys.length ? (
          <Table>
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
        ) : <EmptyState title="No tokens yet" description={`Create a token when you are ready to connect an agent through ${BRAND.name} scoped MCP/API access.`} />}
      </Panel>
      <Panel title="Connect an agent" meta="MCP + API">
        <div className="grid gap-5 text-sm">
          <p className="text-muted-foreground">Point any MCP client or HTTP agent at your workspace with a scoped token. A token carries only the scopes you grant, and every write is recorded in activity.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>MCP endpoint</FieldLabel>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">{origin}/mcp</code>
                <CopyButton value={`${origin}/mcp`} />
              </div>
            </Field>
            <Field>
              <FieldLabel>REST base</FieldLabel>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">{origin}/api</code>
                <CopyButton value={`${origin}/api`} />
              </div>
            </Field>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>Create a post (MCP, JSON-RPC)</FieldLabel>
              <CopyButton value={mcpExample} />
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">{mcpExample}</pre>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>List posts (REST)</FieldLabel>
              <CopyButton value={restExample} />
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">{restExample}</pre>
          </div>
          <div className="grid gap-2">
            <p className="font-medium text-foreground">Scopes</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(scopeCopy).map(([scope, copy]) => (
                <div key={scope} className="flex items-start gap-2 rounded-lg border border-border bg-background p-3">
                  <code className="shrink-0 font-mono text-xs text-foreground">{scope}</code>
                  <span className="text-xs text-muted-foreground">{copy.description}{copy.risk ? <span className="ml-1 font-medium text-destructive">({copy.risk})</span> : null}</span>
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
