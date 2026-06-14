import { BRAND, ENTITLEMENTS, MEDIA, PRICING, readFormStatus } from "@vc/config";
import { canManageApiKeys, listApiKeys } from "@/server/api-keys";
import { getBilling, isSelfHosted } from "@/server/billing";
import type { AppUserContext } from "@/server/onboarding";
import { Badge, Button, ConfirmSubmit, Field, FieldDescription, FieldLabel, FieldLegend, FieldSet, Input, SubmitButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vc/ui";
import { AppShell, EmptyState, PageHeader, Panel, StatusAlert, formatDate } from "./app-layout";
import { ConnectAgent } from "./connect-agent";


export const Settings = async ({ request, ctx }: { request: Request; ctx: { app?: AppUserContext } }) => {
  if (!ctx.app) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const billing = await getBilling(ctx.app.workspaceId);
  const selfHosted = isSelfHosted();
  const isOwner = ctx.app.actor.type === "human" && ctx.app.actor.role === "owner";
  const canManageTokens = canManageApiKeys(ctx.app);
  const canCreateTokens = canManageTokens;
  const apiKeys = await listApiKeys(ctx.app);
  const status = readFormStatus(new URL(request.url).searchParams);
  const origin = new URL(request.url).origin;
  const mcpUrl = `${origin}/mcp`;
  return (
    <AppShell current="/app/settings" userEmail={ctx.app.user.email}>
      <PageHeader kicker="Settings" title="Workspace Settings" description="Manage billing and the scoped credentials agents use to safely operate the blog." />
      <StatusAlert status={status} />
      <Panel title="Billing" meta={<Badge variant="outline">{selfHosted ? "self-hosted" : billing?.status ?? "none"}</Badge>}>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-medium text-foreground">{selfHosted ? "Billing is disabled for this self-hosted workspace" : `${PRICING.planName}: ${PRICING.monthlyLabel} or ${PRICING.annualLabel}`}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {selfHosted ? "Publishing, media uploads, scoped agent access, activity history, and post versions run on your own Cloudflare resources without Polar checkout." : `Drafting, agent tokens, and your first published post are free. Subscribe to publish more, upload media, and make posts search-indexable. Media storage is capped at ${MEDIA.paidStorageLabel}.`}
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
      <Panel title="Agent Access Token" meta={canCreateTokens ? "Draft-only by default" : "Owner access required"}>
        {canCreateTokens ? (
          <form className="grid max-w-3xl gap-4" method="post" action="/app/settings/api-keys/create">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="token-name">Token Name</FieldLabel>
                <Input id="token-name" name="name" required defaultValue="My agent" />
              </Field>
              <Field>
                <FieldLabel htmlFor="token-actor-name">Actor Name</FieldLabel>
                <Input id="token-actor-name" name="actorName" required defaultValue="My agent" />
                <FieldDescription>Shown in activity when this token changes content.</FieldDescription>
              </Field>
            </div>
            <FieldSet className="gap-3">
              <FieldLegend>Capabilities</FieldLegend>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field orientation="horizontal" className="rounded-xl border border-border bg-background p-3 hover:bg-muted/40">
                  <input id="preset-draft" className="mt-1" type="radio" name="preset" value="draft" defaultChecked />
                  <span>
                    <FieldLabel htmlFor="preset-draft" className="text-sm font-medium">Draft assistant</FieldLabel>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">Read, create, and edit drafts and upload media. You review and publish. Recommended.</span>
                  </span>
                </Field>
                <Field orientation="horizontal" className="rounded-xl border border-border bg-background p-3 hover:bg-muted/40">
                  <input id="preset-full" className="mt-1" type="radio" name="preset" value="full" />
                  <span>
                    <FieldLabel htmlFor="preset-full" className="flex items-center gap-2 text-sm font-medium">Full publisher <Badge variant="destructive" className="text-[0.65rem] uppercase">can publish</Badge></FieldLabel>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">Everything in Draft assistant plus publishing and archiving live posts.</span>
                  </span>
                </Field>
              </div>
            </FieldSet>
            <SubmitButton className="w-fit" pendingText="Creating token…">Create token</SubmitButton>
          </form>
        ) : <p className="text-sm text-muted-foreground">Only workspace owners can create agent access tokens.</p>}
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
      <Panel title="Connect an agent" meta="MCP over HTTPS">
        <ConnectAgent mcpUrl={mcpUrl} />
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
