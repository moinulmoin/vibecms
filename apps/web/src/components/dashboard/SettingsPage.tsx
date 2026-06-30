'use client'

import { DEFAULT_PRESET_ID, ENTITLEMENTS, MEDIA, PRESET_IDS, PRICING, THEME_PRESETS } from '@vc/config'
import type { CustomDomainsPanel, CustomDomainView } from '~/server/custom-domains'
import { DownloadIcon } from '@radix-ui/react-icons'
import {
  Field,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Textarea,
  cn,
} from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { renderRichContent, RichContentFrame } from '~/lib/markdown'
import {
  Button,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
} from '~/components/dashboard/DashboardLayout'
import { Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import {
  addCustomDomainMutation,
  removeCustomDomainMutation,
  loadSettingsPage,
  updateSiteSettingsMutation,
} from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch, emptyDashboardStatusSearch } from '~/lib/dashboard-search'

type SiteSettingsForm = {
  name: string
  description: string
  defaultSeoTitle: string
  defaultSeoDescription: string
  theme: string
  slug: string
}

type SettingsPageData = {
  site: SiteSettingsForm
  customDomains: CustomDomainsPanel
  billingStatus: string
  selfHosted: boolean
  isOwner: boolean
}

function BillingStatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        Active
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  )
}

function DomainStatusBadge({ status }: { status: CustomDomainView['status'] }) {
  if (status === 'active') {
    return (
      <Badge className="gap-1.5 border-brand-bright/30 bg-brand-bright/10 text-primary">
        <span className="size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]" />
        Active
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 capitalize text-destructive">
        failed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Canonical markdown sample - exercises the full renderer vocabulary.
// Computed once at module load; safe because renderRichContent is synchronous.
// ---------------------------------------------------------------------------
const CANONICAL_SAMPLE_MD = `## Sample heading

[[toc]]

### Introduction

Write compelling posts with **bold text**, *italic text*, and [links](https://example.com).

> [!NOTE]
> Notes add context without interrupting the narrative.

> [!TIP]
> Tips help readers get the most from their reading.

> [!WARNING]
> Warnings flag important caveats or breaking changes.

### Code block

\`\`\`ts
export async function getPost(id: string) {
  return db.posts.findById(id)
}
\`\`\`

### Media

![A sample blog header image](https://picsum.photos/seed/vc/800/400)
*Caption: a hero image sets the tone for every preset.*

### Comparison table

| Preset | Density | Best for |
| ------ | ------- | -------- |
| Minimal | Airy | General writing |
| Editorial | Comfortable | Narrative |
| Technical | Tight | Docs and reference |
| Product | Clean | Launch posts |

> Style is a point of view - pick the preset that fits your content.
`

const SAMPLE_RENDER = renderRichContent(CANONICAL_SAMPLE_MD)

export function SettingsPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<SettingsPageData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removeDomainPending, setRemoveDomainPending] = useState<string | null>(null)
  const [formPending, setFormPending] = useState<'site' | 'theme' | 'domain' | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<string>('minimal')
  const [previewMode, setPreviewMode] = useState<'light' | 'dark' | 'system'>('system')

  useEffect(() => {
    let cancelled = false
    void loadSettingsPage()
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded)
          setSelectedTheme(loaded.site.theme)
        }
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
    setFormPending('site')
    try {
      const result = await updateSiteSettingsMutation({
        data: {
          name: String(form.get('name') ?? ''),
          description: String(form.get('description') ?? '') || undefined,
          defaultSeoTitle: String(form.get('defaultSeoTitle') ?? ''),
          defaultSeoDescription: String(form.get('defaultSeoDescription') ?? '') || undefined,
          theme: data?.site.theme ?? selectedTheme,
        },
      })
      await navigate({
        to: '/dashboard/settings',
        search: dashboardStatusSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code }),
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleThemeSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data) return
    setFormPending('theme')
    try {
      const result = await updateSiteSettingsMutation({
        data: {
          name: data.site.name,
          description: data.site.description || undefined,
          defaultSeoTitle: data.site.defaultSeoTitle,
          defaultSeoDescription: data.site.defaultSeoDescription || undefined,
          theme: selectedTheme,
        },
      })
      if (result.kind === 'ok') {
        setData((prev) => prev ? { ...prev, site: { ...prev.site, theme: selectedTheme } } : prev)
      }
      await navigate({
        to: '/dashboard/settings',
        search: dashboardStatusSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code }),
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleAddDomain(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const hostname = String(form.get('hostname') ?? '').trim()
    setFormPending('domain')
    try {
      const result = await addCustomDomainMutation({ data: { hostname } })
      if (result.ok) {
        const refreshed = await loadSettingsPage()
        setData(refreshed)
      }
      await navigate({
        to: '/dashboard/settings',
        search: dashboardStatusSearch(result.ok ? { ok: 'domain_added' } : { error: result.code }),
      })
    } finally {
      setFormPending(null)
    }
  }

  async function handleRemoveDomain(domainId: string) {
    setRemoveDomainPending(domainId)
    try {
      const result = await removeCustomDomainMutation({ data: { domainId } })
      const refreshed = await loadSettingsPage()
      setData(refreshed)
      await navigate({
        to: '/dashboard/settings',
        search: dashboardStatusSearch(result.ok ? { ok: 'domain_removed' } : { error: result.code }),
      })
    } finally {
      setRemoveDomainPending(null)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!data) {
    return (
      <>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </>
    )
  }

  const { site, customDomains, billingStatus, selfHosted, isOwner } = data

  return (
    <>
      <PageHeader
        kicker="Settings"
        title="Workspace Settings"
        description="Manage billing, your domain, and workspace preferences."
      />
      <Tabs defaultValue="general" className="gap-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="domain">Domain</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="general" className="grid gap-4">
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
          <PendingSubmitButton className="w-fit" pending={formPending === 'site'} pendingText="Saving…">
            Save site settings
          </PendingSubmitButton>
        </form>
      </Panel>
      <Panel title="Public blog" meta="Theme">
        <p className="mb-4 font-sans text-sm text-muted-foreground">
          Changes public blog appearance and future agent guidance. Does not rewrite existing content.
        </p>
        <form className="grid gap-4" onSubmit={(e) => void handleThemeSave(e)}>
          <FieldSet>
            <FieldLegend className="sr-only">Preset</FieldLegend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRESET_IDS.map((id) => {
                const preset = THEME_PRESETS[id]
                const isCurrent = site.theme === id
                const isDefault = id === DEFAULT_PRESET_ID
                return (
                  <Field
                    key={id}
                    orientation="horizontal"
                    className={cn(
                      'rounded-xl bg-muted/50 p-3 transition-colors hover:bg-muted',
                      'has-[:checked]:ring-1 has-[:checked]:ring-brand-bright/40',
                    )}
                  >
                    <input
                      id={`theme-${id}`}
                      className="mt-1 accent-[var(--brand-bright)]"
                      type="radio"
                      name="theme"
                      value={id}
                      checked={selectedTheme === id}
                      onChange={() => setSelectedTheme(id)}
                    />
                    <span>
                      <FieldLabel
                        htmlFor={`theme-${id}`}
                        className="flex flex-wrap items-center gap-1.5 font-display text-sm font-medium"
                      >
                        {preset.name}
                        {isCurrent && (
                          <Badge className="gap-1 border-brand-bright/30 bg-brand-bright/10 text-primary text-[0.65rem]">
                            Current live theme
                          </Badge>
                        )}
                        {isDefault && (
                          <Badge variant="outline" className="font-mono text-[0.65rem] uppercase">
                            Default
                          </Badge>
                        )}
                      </FieldLabel>
                      <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">
                        {preset.designIntent}
                      </span>
                    </span>
                  </Field>
                )
              })}
            </div>
          </FieldSet>
          {selectedTheme !== site.theme && (
            <p className="font-sans text-xs text-amber-600 dark:text-amber-400">
              Theme not yet saved.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <PendingSubmitButton className="w-fit" pending={formPending === 'theme'} pendingText="Saving theme...">
              Save theme
            </PendingSubmitButton>
            {site.slug ? (
              <Button asChild variant="outline">
                <a href={`/blog/${site.slug}`} target="_blank" rel="noopener noreferrer">
                  View public blog
                </a>
              </Button>
            ) : null}
          </div>
        </form>
        <div className="mt-6 rounded-2xl border bg-muted/30 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Illustrative preview
            </p>
            <div className="flex gap-1 rounded-lg border bg-background p-0.5 text-xs">
              {(['light', 'system', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    'rounded-md px-2 py-1 capitalize transition-colors',
                    previewMode === mode
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <RichContentFrame node={SAMPLE_RENDER.node} presetId={selectedTheme} mode={previewMode} />
          </div>
        </div>
      </Panel>
        </TabsContent>
        <TabsContent value="domain" className="grid gap-4">
      {isOwner ? (
        <Panel title="Custom domain" meta="Bring your own domain">
          <p className="mb-4 font-sans text-sm text-muted-foreground">
            Serve your blog on your own domain (for example blog.example.com). Requires an active subscription.
          </p>
          <form className="mb-4 flex max-w-3xl flex-wrap items-end gap-3" onSubmit={(e) => void handleAddDomain(e)}>
            <Field className="flex-1">
              <FieldLabel htmlFor="domain-hostname">Domain</FieldLabel>
              <Input id="domain-hostname" name="hostname" placeholder="blog.example.com" autoComplete="off" required />
            </Field>
            <PendingSubmitButton className="w-fit" pending={formPending === 'domain'} pendingText="Adding…">
              Add domain
            </PendingSubmitButton>
          </form>
          {customDomains.cnameTarget ? (
            <p className="mb-4 font-sans text-xs leading-5 text-muted-foreground">
              After adding, create a CNAME record pointing your domain to{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{customDomains.cnameTarget}</code>. We verify and issue SSL automatically.
            </p>
          ) : null}
          {customDomains.domains.length ? (
            <div className="grid gap-3">
              {customDomains.domains.map((domain) => (
                <article className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 p-4" key={domain.id}>
                  <div className="min-w-0">
                    <strong className="break-words font-display text-foreground">{domain.hostname}</strong>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <DomainStatusBadge status={domain.status} />
                      {domain.verificationErrors.length ? (
                        <span className="font-sans text-xs text-muted-foreground">{domain.verificationErrors[0]}</span>
                      ) : null}
                    </div>
                  </div>
                  <SpaConfirmButton
                    size="sm"
                    confirmLabel="Confirm remove"
                    helperText="Removing stops serving your blog on this domain."
                    disabled={removeDomainPending === domain.id}
                    onConfirm={() => handleRemoveDomain(domain.id)}
                  >
                    Remove
                  </SpaConfirmButton>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No custom domains" description="Add a domain above to serve your blog on your own URL." />
          )}
        </Panel>
      ) : null}
        </TabsContent>
        <TabsContent value="billing" className="grid gap-4">
      <Panel
        title="Billing"
        meta={selfHosted ? <Badge variant="outline">self-hosted</Badge> : <BillingStatusBadge status={billingStatus} />}
      >
        <div className="rounded-2xl bg-muted/50 p-4 md:p-5">
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
                  <Link to="/dashboard/billing" search={emptyDashboardStatusSearch}>Subscribe / manage billing</Link>
                </Button>
              </div>
            ) : (
              <p className="font-sans text-sm text-muted-foreground">Only workspace owners can manage billing.</p>
            )}
          </div>
        </div>
      </Panel>
        </TabsContent>
        <TabsContent value="data" className="grid gap-4">
      {isOwner ? (
        <Panel title="Your data" meta="Export">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-muted/50 p-4 md:p-5">
            <div className="flex min-w-0 items-start gap-3">
              <DownloadIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
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
            <span className="rounded-xl bg-muted/50 px-3 py-2.5 leading-5" key={entitlement}>
              {entitlement}
            </span>
          ))}
        </div>
      </Panel>
        </TabsContent>
      </Tabs>
    </>
  )
}