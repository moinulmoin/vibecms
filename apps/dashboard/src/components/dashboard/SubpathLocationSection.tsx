import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, LoaderCircle, LockKeyhole } from 'lucide-react'
import { CopyButton, Field, FieldLabel, Input } from '@vc/ui'
import { Button, formatRelative } from '~/components/dashboard/DashboardLayout'
import { PageTabs, Section, StatusBadge, Step, Steps } from '~/components/dashboard/blocks'
import { CodeBlock } from '~/components/dashboard/ConnectAgent'
import { Tabs, TabsContent } from '~/components/ui/tabs'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import {
  checkSubpathLocationMutation,
  removeSubpathLocationMutation,
  rotateSubpathLocationMutation,
  setSubpathLocationMutation,
} from '~/lib/api-client'
import type { SiteLocationCheck, SiteLocationView, SubpathSnippets } from '~/types/dashboard'

const SUBPATH_STATUS_COPY: Record<NonNullable<SiteLocationView['status']>, string> = {
  pending: 'Waiting for the proxy. Add the snippet below, then check the setup.',
  active: 'Live at this address.',
  failed: 'The last check failed. Review the errors below, fix the proxy, then check again.',
  disabled: 'Paused. It comes back when your plan is active.',
}

const PLATFORM_TABS = [
  { value: 'cloudflareWorker', label: 'Cloudflare Worker', file: 'worker.js' },
  { value: 'vercel', label: 'Vercel', file: 'vercel.json' },
  { value: 'nextjs', label: 'Next.js', file: 'next.config.js' },
  { value: 'netlify', label: 'Netlify', file: '_redirects' },
  { value: 'nginx', label: 'nginx', file: 'nginx.conf' },
  { value: 'caddy', label: 'Caddy', file: 'Caddyfile' },
] as const

// Validation problems (bad URL, host already in use) belong next to the field;
// access/billing failures keep the toast path via the returned code.
const CONNECT_FIELD_ERRORS: Record<string, string> = {
  location_invalid: 'Enter a full https URL with a path, for example https://example.com/blog.',
  domain_conflict: 'That path is already connected to another blog.',
}

function stripProtocol(url: string) {
  return url.replace(/^https?:\/\//, '')
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-[0.8125rem] text-foreground">{value}</p>
      </div>
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} copiedLabel="Copied" iconOnly variant="ghost" className="size-8 shrink-0" />
    </div>
  )
}

function snippetFor(snippets: SubpathSnippets, platform: (typeof PLATFORM_TABS)[number]['value']): string {
  return platform === 'cloudflareWorker' ? snippets.cloudflareWorker.code : snippets[platform]
}

export function SubpathLocationSection({
  location,
  locked,
  customDomainActive,
  feedback,
  refresh,
}: {
  /** Missing on stale settings payloads: treated as "no subpath" like the API default. */
  location?: SiteLocationView | null
  locked: boolean
  customDomainActive: boolean
  feedback: (result: { ok?: string; error?: string }) => void
  refresh: () => Promise<unknown>
}) {
  const [pending, setPending] = useState<'connect' | 'check' | 'rotate' | 'remove' | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<SiteLocationCheck | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const subpath = location?.type === 'subpath' && location.url ? { view: location, url: location.url } : null

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const url = String(new FormData(event.currentTarget).get('url') ?? '').trim()
    setPending('connect')
    try {
      const result = await setSubpathLocationMutation({ url })
      await refresh()
      if (result.ok) {
        setConnectError(null)
        feedback({ ok: 'location_connected' })
      } else if (result.code in CONNECT_FIELD_ERRORS) {
        setConnectError(CONNECT_FIELD_ERRORS[result.code]!)
      } else {
        feedback({ error: result.code })
      }
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setPending(null)
    }
  }

  async function handleCheck() {
    setPending('check')
    try {
      const result = await checkSubpathLocationMutation()
      await refresh()
      if (result.ok) setCheckResult(result.check)
      else feedback({ error: result.code })
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setPending(null)
    }
  }

  async function handleRotate() {
    setPending('rotate')
    try {
      const result = await rotateSubpathLocationMutation()
      await refresh()
      if (result.ok) {
        setCheckResult(null)
        setNotice(result.warning)
      } else {
        feedback({ error: result.code })
      }
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setPending(null)
    }
  }

  async function handleRemove() {
    setPending('remove')
    try {
      const result = await removeSubpathLocationMutation()
      await refresh()
      if (result.ok) {
        setCheckResult(null)
        setNotice(null)
        feedback({ ok: 'location_removed' })
      } else {
        feedback({ error: result.code })
      }
    } catch {
      feedback({ error: 'unknown' })
    } finally {
      setPending(null)
    }
  }

  const shownCheck = checkResult ?? subpath?.view.lastCheck ?? null
  const snippets = subpath?.view.snippets
  // The proxy target's origin is this site's default address (<slug>.<blog domain>).
  const defaultAddress = subpath?.view.proxyTarget ? new URL(subpath.view.proxyTarget).origin : null
  const sitemapLine = subpath ? `Sitemap: ${subpath.url}/sitemap.xml` : null
  const llmsPath = subpath ? `${new URL(subpath.url).pathname}/llms.txt` : null

  return (
    <Section
      layout="aside"
      title="On a path of your site"
      description="Serve the blog at a path of the site you already run, like example.com/blog. Search engines treat it as part of your main site."
    >
      {/* Paid-plan gate: connects/checks/rotates only. Disconnect stays reachable
          because removing a location is authorization-only, not a paid op. */}
      {locked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
          <LockKeyhole aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <p className="flex-1 text-sm text-muted-foreground">A blog on your site’s path is part of the paid plan.</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/settings" search={{ ok: undefined, error: undefined, tab: 'billing' }}>
              See plans
            </Link>
          </Button>
        </div>
      ) : null}
      {!subpath ? (
        locked ? null : (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void handleConnect(event)}>
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="location-url">Blog URL</FieldLabel>
              <Input
                id="location-url"
                name="url"
                type="url"
                placeholder="https://example.com/blog"
                autoComplete="off"
                spellCheck={false}
                required
                aria-invalid={!!connectError}
                aria-describedby={connectError ? 'location-url-error' : undefined}
                onChange={() => setConnectError(null)}
              />
              {connectError ? (
                <p id="location-url-error" className="text-sm text-destructive">
                  {connectError}
                </p>
              ) : null}
            </Field>
            <PendingSubmitButton pending={pending === 'connect'} pendingText="Connecting…">
              Connect
            </PendingSubmitButton>
          </form>
        )
      ) : (
        <>
          <div className="grid gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <strong className="break-all font-medium text-foreground">{stripProtocol(subpath.url)}</strong>
              {subpath.view.status ? <StatusBadge status={subpath.view.status} /> : null}
            </div>
            {subpath.view.status ? <p className="text-sm leading-6 text-muted-foreground">{SUBPATH_STATUS_COPY[subpath.view.status]}</p> : null}
            {customDomainActive ? (
              <p className="text-sm leading-6 text-muted-foreground">
                This path is the blog’s primary address — your custom domain redirects to it.
              </p>
            ) : null}
            {notice ? <p className="text-sm leading-6 text-warning-foreground">{notice}</p> : null}
          </div>

          <Steps>
            <Step
              n={1}
              state="plain"
              title="Add the proxy"
              titleAs="h3"
              detail={`Send ${stripProtocol(subpath.url)} and everything under it to the proxy target. Pick your platform for a ready-to-paste config.`}
            >
              {subpath.view.proxyTarget ? <CopyRow label="Proxy target" value={subpath.view.proxyTarget} /> : null}
              {snippets ? (
                <Tabs defaultValue="cloudflareWorker" className="gap-4">
                  <PageTabs label="Proxy platform" tabs={PLATFORM_TABS.map((tab) => ({ value: tab.value, label: tab.label }))} />
                  {PLATFORM_TABS.map((tab) => (
                    <TabsContent key={tab.value} value={tab.value} className="grid min-w-0 gap-3">
                      {tab.value === 'cloudflareWorker' ? (
                        <>
                          <CopyRow label="Route" value={snippets.cloudflareWorker.route} />
                          <p className="text-sm text-muted-foreground">
                            Works on the Workers Free plan (100,000 requests a day).
                          </p>
                        </>
                      ) : null}
                      <CodeBlock label={tab.file} code={snippetFor(snippets, tab.value)} copyLabel="Copy snippet" />
                    </TabsContent>
                  ))}
                </Tabs>
              ) : null}
            </Step>

            <Step
              n={2}
              state="plain"
              title="Check setup"
              titleAs="h3"
              detail="We fetch your path’s health address through the proxy and compare it with this blog."
            >
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" size="sm" disabled={locked || pending === 'check'} onClick={() => void handleCheck()}>
                  {pending === 'check' ? <LoaderCircle aria-hidden data-icon="inline-start" className="animate-spin" /> : null}
                  {pending === 'check' ? 'Checking…' : 'Check setup'}
                </Button>
                {shownCheck ? (
                  <p className="text-sm text-muted-foreground">
                    Last checked <time dateTime={new Date(shownCheck.checkedAt * 1000).toISOString()}>{formatRelative(shownCheck.checkedAt)}</time>
                  </p>
                ) : null}
              </div>
              {shownCheck ? (
                <div role="status" className="grid gap-2">
                  {shownCheck.ok ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground">
                      <p>Connected. Your blog is live at {stripProtocol(subpath.url)}.</p>
                      <Button asChild variant="ghost" size="sm">
                        <a href={subpath.url} target="_blank" rel="noopener">
                          <ExternalLink aria-hidden data-icon="inline-start" /> Open
                        </a>
                      </Button>
                    </div>
                  ) : null}
                  {shownCheck.errors.length ? (
                    <ul className="grid gap-1 text-sm text-destructive">
                      {shownCheck.errors.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                      ))}
                    </ul>
                  ) : null}
                  {shownCheck.warnings.length ? (
                    <ul className="grid gap-1 text-sm text-warning-foreground">
                      {shownCheck.warnings.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </Step>

            <Step
              n={3}
              state="plain"
              title="Tell search engines"
              titleAs="h3"
              optional
              detail={`Add this line to your site’s robots.txt. Your root llms.txt can also link to ${llmsPath}.`}
            >
              {sitemapLine ? <CopyRow label="robots.txt" value={sitemapLine} /> : null}
            </Step>
          </Steps>

          <div className="flex flex-wrap items-center gap-4">
            <SpaConfirmButton
              size="sm"
              variant="ghost"
              confirmLabel="Rotate the link"
              helperText="The old link stops working at once. Update your proxy right after."
              disabled={locked || pending !== null}
              onConfirm={handleRotate}
              className="text-muted-foreground"
            >
              New proxy link
            </SpaConfirmButton>
            <SpaConfirmButton
              size="sm"
              variant="ghost"
              confirmLabel="Disconnect"
              helperText={defaultAddress ? `Your blog goes back to ${stripProtocol(defaultAddress)}.` : 'Your blog goes back to its default address.'}
              disabled={pending !== null}
              onConfirm={handleRemove}
              className="text-muted-foreground"
            >
              Disconnect
            </SpaConfirmButton>
          </div>
        </>
      )}
    </Section>
  )
}
