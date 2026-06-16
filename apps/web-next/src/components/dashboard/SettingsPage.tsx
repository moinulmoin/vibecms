'use client'

import { BRAND, ENTITLEMENTS, MEDIA, PRICING } from '@vc/config'
import type { ApiKeyListItem } from '~/server/api-keys'
import { DownloadIcon } from '@radix-ui/react-icons'
import {
  Badge,
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  Button,
  EmptyState,
  PageHeader,
  Panel,
  StatusAlert,
  formatDate,
} from '~/components/dashboard/DashboardLayout'
import { ConnectAgent } from '~/components/dashboard/ConnectAgent'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import {
  createApiKeyMutation,
  loadSettingsPage,
  revokeApiKeyMutation,
  updateSiteSettingsMutation,
} from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch, emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { saveTokenFlash } from '~/lib/token-flash'

type SiteSettingsForm = {
  name: string
  description: string
  defaultSeoTitle: string
  defaultSeoDescription: string
}

type SettingsPageData = {
  site: SiteSettingsForm
  apiKeys: ApiKeyListItem[]
  billingStatus: string
  selfHosted: boolean
  isOwner: boolean
  canManageTokens: boolean
  mcpUrl: string
}

export function SettingsPage() {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()
  const [data, setData] = useState<SettingsPageData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [revokePending, setRevokePending] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadSettingsPage()
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load settings.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSiteSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = await updateSiteSettingsMutation({
      data: {
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? '') || undefined,
        defaultSeoTitle: String(form.get('defaultSeoTitle') ?? ''),
        defaultSeoDescription: String(form.get('defaultSeoDescription') ?? '') || undefined,
      },
    })
    await navigate({
      to: '/app/settings',
      search: dashboardStatusSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code }),
    })
  }

  async function handleCreateToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const preset = form.get('preset') === 'full' ? 'full' : 'draft'
    const result = await createApiKeyMutation({
      data: {
        name: String(form.get('name') ?? 'My agent'),
        actorName: String(form.get('actorName') ?? 'My agent'),
        preset,
      },
    })
    if (result.kind === 'ok') {
      saveTokenFlash({ token: result.token, name: result.name })
      await navigate({ to: '/app/settings/token-created', search: emptyDashboardStatusSearch })
      return
    }
    await navigate({ to: '/app/settings', search: dashboardStatusSearch({ error: result.code }) })
  }

  async function handleRevoke(keyId: string) {
    setRevokePending(keyId)
    try {
      const result = await revokeApiKeyMutation({ data: { keyId } })
      const refreshed = await loadSettingsPage()
      setData(refreshed)
      await navigate({
        to: '/app/settings',
        search: dashboardStatusSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code }),
      })
    } finally {
      setRevokePending(null)
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>
  if (!data) return <p className="font-mono text-sm text-muted-foreground">Loading settings…</p>

  const { site, apiKeys, billingStatus, selfHosted, isOwner, canManageTokens, mcpUrl } = data

  return (
    <>
      <PageHeader
        kicker="Settings"
        title="Workspace Settings"
        description="Manage billing and the scoped credentials agents use to safely operate the blog."
      />
      <StatusAlert status={formStatus} />
      <Panel title="Site" meta="Name & SEO defaults">
        <form className="grid max-w-3xl gap-4" onSubmit={(e) => void handleSiteSave(e)}>
          <Field>
            <FieldLabel htmlFor="site-name">Blog name</FieldLabel>
            <Input id="site-name" name="name" required maxLength={80} defaultValue={site.name} />
          </Field>
          <Field>
            <FieldLabel htmlFor="site-description">Description</FieldLabel>
            <Textarea id="site-description" name="description" maxLength={220} rows={3} defaultValue={site.description} />
          </Field>
          <Field>
            <FieldLabel htmlFor="default-seo-title">Default SEO title</FieldLabel>
            <Input id="default-seo-title" name="defaultSeoTitle" required maxLength={120} defaultValue={site.defaultSeoTitle} />
          </Field>
          <Field>
            <FieldLabel htmlFor="default-seo-description">Default SEO description</FieldLabel>
            <Textarea
              id="default-seo-description"
              name="defaultSeoDescription"
              maxLength={220}
              rows={3}
              defaultValue={site.defaultSeoDescription}
            />
          </Field>
          <PendingSubmitButton className="w-fit" pendingText="Saving…">
            Save site settings
          </PendingSubmitButton>
        </form>
      </Panel>
      <Panel title="Billing" meta={<Badge variant="outline">{selfHosted ? 'self-hosted' : billingStatus}</Badge>}>
        <div className="rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] md:p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-display text-sm font-medium text-foreground">
                {selfHosted
                  ? 'Billing is disabled for this self-hosted workspace'
                  : `${PRICING.planName}: ${PRICING.monthlyLabel} or ${PRICING.annualLabel}`}
              </p>
              <p className="mt-2 max-w-2xl font-sans text-sm leading-6 text-muted-foreground">
                {selfHosted
                  ? 'Publishing, media uploads, scoped agent access, activity history, and post versions run on your own Cloudflare resources without Polar checkout.'
                  : `Drafting, agent tokens, and your first published post are free. Subscribe to publish more, upload media, and make posts search-indexable. Media storage is capped at ${MEDIA.paidStorageLabel}.`}
              </p>
            </div>
            {selfHosted ? (
              <Badge variant="outline" className="w-fit font-mono text-[11px] uppercase tracking-[0.08em] lg:justify-self-end">
                SELF_HOSTED=true
              </Badge>
            ) : isOwner ? (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button asChild>
                  <Link to="/app/billing" search={emptyDashboardStatusSearch}>Subscribe / manage billing</Link>
                </Button>
              </div>
            ) : (
              <p className="font-sans text-sm text-muted-foreground">Only workspace owners can manage billing.</p>
            )}
          </div>
        </div>
      </Panel>
      <Panel title="Agent Access Token" meta={canManageTokens ? 'Draft-only by default' : 'Owner access required'}>
        {canManageTokens ? (
          <form
            className="grid max-w-3xl gap-4 rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] md:p-5"
            onSubmit={(e) => void handleCreateToken(e)}
          >
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
                <Field
                  orientation="horizontal"
                  className="rounded-2xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] hover:ring-brand-bright/30 has-[:checked]:ring-2 has-[:checked]:ring-brand-bright/40"
                >
                  <input id="preset-draft" className="mt-1 accent-[var(--brand-bright)]" type="radio" name="preset" value="draft" defaultChecked />
                  <span>
                    <FieldLabel htmlFor="preset-draft" className="font-display text-sm font-medium">
                      Draft assistant
                    </FieldLabel>
                    <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">
                      Read, create, and edit drafts and upload media. You review and publish. Recommended.
                    </span>
                  </span>
                </Field>
                <Field
                  orientation="horizontal"
                  className="rounded-2xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] hover:ring-brand-bright/30 has-[:checked]:ring-2 has-[:checked]:ring-brand-bright/40"
                >
                  <input id="preset-full" className="mt-1 accent-[var(--brand-bright)]" type="radio" name="preset" value="full" />
                  <span>
                    <FieldLabel htmlFor="preset-full" className="flex items-center gap-2 font-display text-sm font-medium">
                      Full publisher <Badge variant="destructive" className="font-mono text-[0.65rem] uppercase">can publish</Badge>
                    </FieldLabel>
                    <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">
                      Everything in Draft assistant plus publishing and archiving live posts.
                    </span>
                  </span>
                </Field>
              </div>
            </FieldSet>
            <PendingSubmitButton className="w-fit" pendingText="Creating token…">
              Create token
            </PendingSubmitButton>
          </form>
        ) : (
          <p className="font-sans text-sm text-muted-foreground">Only workspace owners can create agent access tokens.</p>
        )}
      </Panel>
      <Panel title="Existing Tokens" meta={`${apiKeys.length} total`}>
        {apiKeys.length ? (
          <>
            <div className="grid gap-3 md:hidden">
              {apiKeys.map((key) => (
                <article
                  className="grid gap-3 rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]"
                  key={key.id}
                >
                  <div className="min-w-0">
                    <strong className="font-display text-foreground">{key.name}</strong>
                    <p className="mt-1 font-mono text-xs text-brand-bright">{key.tokenPrefix}…</p>
                    <p className="mt-1 break-words font-mono text-[11px] leading-5 text-muted-foreground">{key.scopes.join(', ')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                    <Badge variant={key.revokedAt ? 'secondary' : 'outline'}>{key.revokedAt ? 'revoked' : 'active'}</Badge>
                    <span>Last used {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'never'}</span>
                  </div>
                  {!key.revokedAt ? (
                    <SpaConfirmButton
                      size="sm"
                      confirmLabel="Confirm revoke"
                      helperText="Revoking immediately blocks this token."
                      disabled={revokePending === key.id}
                      onConfirm={() => handleRevoke(key.id)}
                    >
                      Revoke
                    </SpaConfirmButton>
                  ) : null}
                </article>
              ))}
            </div>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <strong className="font-display text-foreground">{key.name}</strong>
                      <p className="mt-1 font-mono text-xs text-brand-bright">{key.tokenPrefix}…</p>
                      <p className="mt-1 max-w-2xl truncate font-mono text-[11px] text-muted-foreground">{key.scopes.join(', ')}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.revokedAt ? 'secondary' : 'outline'}>{key.revokedAt ? 'revoked' : 'active'}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'never used'}
                    </TableCell>
                    <TableCell className="text-right">
                      {!key.revokedAt ? (
                        <SpaConfirmButton
                          size="sm"
                          confirmLabel="Confirm revoke"
                          helperText="Revoking immediately blocks this token."
                          disabled={revokePending === key.id}
                          onConfirm={() => handleRevoke(key.id)}
                        >
                          Revoke
                        </SpaConfirmButton>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <EmptyState
            title="No tokens yet"
            description={`Create a token when you are ready to connect an agent through ${BRAND.name}.`}
          />
        )}
      </Panel>
      <Panel title="Connect an agent" meta="MCP over HTTPS">
        <ConnectAgent mcpUrl={mcpUrl} />
      </Panel>
      {isOwner ? (
        <Panel title="Your data" meta="Export">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] md:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <DownloadIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-bright" />
              <p className="font-sans text-sm leading-6 text-muted-foreground">
                Download every post (drafts, published, and archived) as JSON. Your content is yours to keep, with no lock-in.
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <a href="/api/export.json">Export posts</a>
            </Button>
          </div>
        </Panel>
      ) : null}
      <Panel title="Plan Includes" meta={PRICING.planName}>
        <div className="grid gap-2 font-sans text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
          {ENTITLEMENTS.map((entitlement) => (
            <span
              className="rounded-2xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]"
              key={entitlement}
            >
              {entitlement}
            </span>
          ))}
        </div>
      </Panel>
    </>
  )
}