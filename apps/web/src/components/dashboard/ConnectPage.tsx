'use client'

import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { MEDIA, PRICING } from '@vc/config'
import type { Scope } from '@vc/core'
import { CopyButton, Field, FieldDescription, FieldLabel, FieldLegend, FieldSet, Input } from '@vc/ui'
import { CheckIcon } from '@radix-ui/react-icons'
import { Button, EmptyState, PageHeader, Panel, formatDate } from '~/components/dashboard/DashboardLayout'
import { Skeleton } from '@vc/ui'
import type { ApiKeyListItem } from '~/server/api-keys'
import { ConnectAgent } from '~/components/dashboard/ConnectAgent'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import {
  createApiKeyMutation,
  loadConnectPage,
  loadOnboardingStatus,
  revokeApiKeyMutation,
  type ConnectPageData,
  type OnboardingConnectStatus,
} from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch } from '~/lib/dashboard-search'
import { consumeTokenFlash, saveTokenFlash } from '~/lib/token-flash'
import { checkoutBillingMutation } from '~/server/billing-page-fn'

const MONTHS_FREE = Math.round(12 - PRICING.annualUsd / PRICING.monthlyUsd)

type SelfTestSub = 'waiting' | 'stalled' | 'recovery' | 'connected' | 'revoked'

type TokenPreset = {
  id: 'draft' | 'publish' | 'full'
  label: string
  description: string
  recommended?: boolean
}

const TOKEN_PRESETS: TokenPreset[] = [
  { id: 'draft', label: 'Drafter', description: 'Create and edit drafts and upload media. Cannot publish or archive posts.' },
  { id: 'publish', label: 'Publisher', description: 'Everything in Drafter, plus publish posts live. Cannot archive.', recommended: true },
  { id: 'full', label: 'Full publisher', description: 'Everything in Publisher, plus archive posts.' },
]

function capabilityLabel(scopes: Scope[]): string {
  if (scopes.includes('posts:archive')) return 'Full publisher'
  if (scopes.includes('posts:publish')) return 'Publisher'
  return 'Drafter'
}

function isLive(s: OnboardingConnectStatus | null): boolean {
  return s?.publish?.state === 'live' || s?.publish?.state === 'already_live'
}

function getSub(connection: OnboardingConnectStatus['connection'], elapsedMs: number): SelfTestSub | null {
  if (connection === 'revoked') return 'revoked'
  if (connection === 'connected') return 'connected'
  if (connection === 'waiting') {
    if (elapsedMs > 60_000) return 'recovery'
    if (elapsedMs > 20_000) return 'stalled'
    return 'waiting'
  }
  return null
}

function announcementFor(sub: SelfTestSub | null): string {
  if (sub === 'revoked') return "This token can't be used anymore. Generate a new token to connect an agent."
  if (sub === 'connected') return 'Connected. vibecms saw your agent authenticate.'
  if (sub === 'recovery') return 'Not detected yet. Check your configuration or create a new token.'
  if (sub === 'stalled') return "Still waiting. Some MCP clients don't call tools until you ask."
  if (sub === 'waiting') return 'Waiting for your agent to connect...'
  return ''
}

function UpgradeCtas({
  checkoutPending,
  onCheckout,
}: {
  checkoutPending: 'monthly' | 'yearly' | null
  onCheckout: (interval: 'monthly' | 'yearly') => void
}) {
  return (
    <div className="grid gap-4">
      <p className="font-sans text-sm leading-6 text-muted-foreground">
        Upgrade to make the blog indexable, publish more posts, and upload media.
      </p>

      <ul className="grid gap-2.5 rounded-xl bg-muted/50 p-4 text-sm">
        {(['Indexable public blog', 'More publishes'] as const).map((item) => (
          <li key={item} className="flex items-start gap-2.5">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="font-sans text-foreground">{item}</span>
          </li>
        ))}
        <li className="flex items-start gap-2.5">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="font-sans text-foreground">{MEDIA.paidStorageLabel} media</span>
        </li>
      </ul>

      <div className="grid gap-2 sm:grid-cols-2">
        <PendingSubmitButton
          type="button"
          className="h-11 w-full rounded-xl"
          pending={checkoutPending === 'monthly'}
          pendingText="Starting checkout..."
          onClick={() => onCheckout('monthly')}
        >
          {`Make it discoverable - ${PRICING.monthlyLabel}`}
        </PendingSubmitButton>
        <div className="grid gap-1">
          <PendingSubmitButton
            type="button"
            variant="outline"
            className="h-11 w-full rounded-xl"
            pending={checkoutPending === 'yearly'}
            pendingText="Starting checkout..."
            onClick={() => onCheckout('yearly')}
          >
            {`Save with annual - ${PRICING.annualLabel}`}
          </PendingSubmitButton>
          {MONTHS_FREE >= 1 && (
            <p className="text-center font-mono text-[11px] text-muted-foreground">
              {MONTHS_FREE} {MONTHS_FREE === 1 ? 'month' : 'months'} free
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function TokenRow({
  apiKey,
  pending,
  onDelete,
}: {
  apiKey: ApiKeyListItem
  pending: boolean
  onDelete: (keyId: string) => void
}) {
  return (
    <article className="grid gap-3 rounded-2xl bg-muted/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="font-display text-foreground">{apiKey.name}</strong>
          <p className="mt-1 font-mono text-xs text-primary">{apiKey.tokenPrefix}</p>
          <p className="mt-1 font-sans text-xs leading-5 text-muted-foreground">
            {capabilityLabel(apiKey.scopes)}
          </p>
        </div>
        <SpaConfirmButton
          size="sm"
          confirmLabel="Confirm delete"
          helperText="Deleting permanently blocks this token. The secret cannot be recovered."
          disabled={pending}
          onConfirm={() => onDelete(apiKey.id)}
        >
          Delete token
        </SpaConfirmButton>
      </div>
      <div className="font-mono text-xs text-muted-foreground">
        Last used {apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'never'}
      </div>
    </article>
  )
}

export function ConnectPage() {
  const navigate = useNavigate()

  const [connectData, setConnectData] = useState<ConnectPageData | null>(null)
  const [status, setStatus] = useState<OnboardingConnectStatus | null>(null)
  const [flash, setFlash] = useState<{ token: string; name: string } | null>(null)
  const [createPending, setCreatePending] = useState(false)
  const [revokePending, setRevokePending] = useState<string | null>(null)
  const [checkoutPending, setCheckoutPending] = useState<'monthly' | 'yearly' | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const waitingStartedAtRef = useRef<number | null>(null)
  const lastSubRef = useRef<string>('')
  const stickyConnectedRef = useRef(false)

  async function refreshTokens() {
    try {
      const data = await loadConnectPage()
      setConnectData(data)
    } catch {
      // Keep stale list; the status toast surfaces the failure.
    }
  }

  // Mount: restore a one-time reveal from sessionStorage (reload fallback) and load the token list.
  useEffect(() => {
    setFlash(consumeTokenFlash())
    void refreshTokens()
  }, [])

  // Poll the connection/publish status. Monotonic + terminal-sticky: once connected,
  // the display never regresses to waiting; polling stops once the first post is live.
  useEffect(() => {
    let cancelled = false
    let timerId: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      if (cancelled) return
      try {
        const s = await loadOnboardingStatus()
        if (cancelled) return

        if (s.connection === 'connected') stickyConnectedRef.current = true

        if (s.connection === 'waiting') {
          if (waitingStartedAtRef.current === null) waitingStartedAtRef.current = Date.now()
        } else {
          waitingStartedAtRef.current = null
        }

        const serverConn = s.connection
        const displayConn =
          serverConn === 'no_token' || serverConn === 'revoked'
            ? serverConn
            : stickyConnectedRef.current
              ? 'connected'
              : serverConn

        const elapsedMs = waitingStartedAtRef.current ? Date.now() - waitingStartedAtRef.current : 0
        const sub = getSub(displayConn, elapsedMs)

        const key = `${displayConn}|${s.publish?.state ?? ''}|${sub ?? ''}`
        if (key !== lastSubRef.current) {
          lastSubRef.current = key
          const msg = announcementFor(sub)
          if (msg) setAnnouncement(msg)
        }

        setStatus(s)

        if (!isLive(s)) {
          const interval = stickyConnectedRef.current ? 5_000 : 3_000
          timerId = setTimeout(poll, interval)
        }
      } catch {
        if (!cancelled) timerId = setTimeout(poll, 5_000)
      }
    }

    void poll()
    return () => {
      cancelled = true
      clearTimeout(timerId)
    }
  }, [])

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const rawPreset = String(form.get('preset') ?? 'publish')
    const preset: 'draft' | 'publish' | 'full' =
      rawPreset === 'full' || rawPreset === 'draft' ? rawPreset : 'publish'
    setCreatePending(true)
    stickyConnectedRef.current = false
    try {
      const result = await createApiKeyMutation({
        data: {
          name: String(form.get('name') ?? 'My agent'),
          actorName: String(form.get('actorName') ?? 'My agent'),
          preset,
        },
      })
      if (result.kind === 'ok') {
        saveTokenFlash({ token: result.token, name: result.name })
        setFlash({ token: result.token, name: result.name })
        await refreshTokens()
        await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ ok: 'token_created' }) })
        return
      }
      await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ error: result.code }) })
    } finally {
      setCreatePending(false)
    }
  }

  async function handleDelete(keyId: string) {
    setRevokePending(keyId)
    stickyConnectedRef.current = false
    try {
      const result = await revokeApiKeyMutation({ data: { keyId } })
      await refreshTokens()
      await navigate({
        to: '/dashboard/connect',
        search: dashboardStatusSearch(result.kind === 'ok' ? { ok: 'token_deleted' } : { error: result.code }),
      })
    } finally {
      setRevokePending(null)
    }
  }

  async function startCheckout(interval: 'monthly' | 'yearly') {
    setCheckoutPending(interval)
    try {
      const result = await checkoutBillingMutation({ data: { interval } })
      if (result.kind === 'ok') {
        window.location.assign(result.url)
        return
      }
      await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ error: 'checkout_failed' }) })
    } catch {
      await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ error: 'checkout_failed' }) })
    } finally {
      setCheckoutPending(null)
    }
  }

  const live = isLive(status)
  const serverConn = status?.connection
  const displayConn =
    serverConn === 'no_token' || serverConn === 'revoked'
      ? serverConn
      : stickyConnectedRef.current
        ? 'connected'
        : serverConn

  const elapsedMs = waitingStartedAtRef.current ? Date.now() - waitingStartedAtRef.current : 0
  const selfTestSub = getSub(displayConn ?? 'no_token', elapsedMs)
  const showSelfTest =
    !live &&
    status !== null &&
    (displayConn === 'waiting' || displayConn === 'connected' || displayConn === 'revoked')

  const mcpUrl = connectData?.mcpUrl ?? status?.mcpUrl ?? ''
  const canManage = connectData?.canManage ?? status?.canManage ?? false
  const apiKeys = connectData?.apiKeys ?? []
  const livePost = status?.publish?.post
  const liveHeading =
    status?.publish?.actor === 'onboarding_agent'
      ? 'Your agent published your first live post.'
      : 'Your first post is live.'

  const pageKicker = live ? 'Live' : 'Connect'
  const pageTitle = live
    ? liveHeading
    : displayConn === 'connected'
      ? 'Agent connected'
      : flash !== null
        ? 'Token created'
        : 'Connect your agent'
  const pageDesc = live
    ? undefined
    : displayConn === 'connected'
      ? 'Your agent authenticated. Paste the starter prompt to publish your first post.'
      : flash !== null
        ? 'Copy the token and config below now. It is shown only once.'
        : 'Create a scoped API token, point your AI agent at the blog over MCP, and manage tokens.'

  const loading = !connectData && !status

  return (
    <>
      <noscript>
        <p className="rounded-xl bg-muted p-4 font-sans text-sm text-muted-foreground">
          vibecms needs JavaScript to manage tokens and detect your agent. Enable JavaScript and refresh this page.
        </p>
      </noscript>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <PageHeader kicker={pageKicker} title={pageTitle} description={pageDesc} />

      {loading && (
        <>
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </>
      )}

      {flash && mcpUrl && (
        <Panel title="Your token is ready">
          <div className="mb-4 rounded-xl bg-brand-bright/10 p-3 font-sans text-sm leading-6 text-primary">
            Copy this token now. For security it is shown only once and cannot be retrieved later.
          </div>
          <ConnectAgent mcpUrl={mcpUrl} token={flash.token} tokenName={flash.name} />
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setFlash(null)}>
              I&apos;ve copied it - hide
            </Button>
          </div>
        </Panel>
      )}

      {showSelfTest && selfTestSub && (
        <Panel title="Connection status">
          <div className="grid gap-3">
            <div
              className={[
                'flex items-start gap-2 rounded-xl p-3 font-sans text-sm leading-5',
                selfTestSub === 'connected'
                  ? 'bg-brand-bright/10 text-primary'
                  : selfTestSub === 'revoked'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted/50 text-foreground',
              ].join(' ')}
            >
              {selfTestSub === 'waiting' && (
                <span
                  className="mt-0.5 inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              <span>
                {selfTestSub === 'waiting' && 'Waiting for your agent to connect...'}
                {selfTestSub === 'stalled' &&
                  "Still waiting. Some MCP clients don't call tools until you ask. Try asking your agent to call sites.get."}
                {selfTestSub === 'recovery' &&
                  'Not detected yet. Check the token, the MCP URL, and the Authorization: Bearer header, or create a new token.'}
                {selfTestSub === 'connected' &&
                  'Connected. vibecms saw your agent authenticate. Paste the starter prompt to publish your first post.'}
                {selfTestSub === 'revoked' &&
                  "This token can't be used anymore. Create a new token below to connect an agent."}
              </span>
            </div>
          </div>
        </Panel>
      )}

      {connectData && (
        <Panel
          title="API tokens"
          meta={canManage ? `${apiKeys.length} active` : 'Owner access required'}
        >
          {canManage ? (
            <div className="grid gap-5">
              <form className="grid gap-4 rounded-2xl bg-muted/50 p-4" onSubmit={(e) => void handleCreate(e)}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="token-name">Token name</FieldLabel>
                    <Input id="token-name" name="name" required maxLength={80} defaultValue="My agent" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="token-actor-name">Actor name</FieldLabel>
                    <Input id="token-actor-name" name="actorName" required maxLength={80} defaultValue="My agent" />
                    <FieldDescription>Shown in activity when this token changes content.</FieldDescription>
                  </Field>
                </div>
                <FieldSet className="gap-3">
                  <FieldLegend>Capabilities</FieldLegend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {TOKEN_PRESETS.map((preset) => (
                      <Field
                        key={preset.id}
                        orientation="horizontal"
                        className="rounded-xl bg-background/60 p-3 transition-colors hover:bg-background has-[:checked]:ring-1 has-[:checked]:ring-brand-bright/40"
                      >
                        <input
                          id={`preset-${preset.id}`}
                          className="mt-1 accent-[var(--brand-bright)]"
                          type="radio"
                          name="preset"
                          value={preset.id}
                          defaultChecked={preset.recommended}
                        />
                        <span>
                          <FieldLabel
                            htmlFor={`preset-${preset.id}`}
                            className="flex items-center gap-1.5 font-display text-sm font-medium"
                          >
                            {preset.label}
                            {preset.recommended && (
                              <span className="font-mono text-[0.6rem] uppercase tracking-wide text-primary">default</span>
                            )}
                          </FieldLabel>
                          <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">
                            {preset.description}
                          </span>
                        </span>
                      </Field>
                    ))}
                  </div>
                </FieldSet>
                <PendingSubmitButton className="w-fit" pending={createPending} pendingText="Creating...">
                  Create token
                </PendingSubmitButton>
              </form>

              {apiKeys.length ? (
                <div className="grid gap-3">
                  {apiKeys.map((key) => (
                    <TokenRow
                      key={key.id}
                      apiKey={key}
                      pending={revokePending === key.id}
                      onDelete={(id) => void handleDelete(id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No tokens yet"
                  description="Create a token above to connect an AI agent to this blog over MCP."
                />
              )}
            </div>
          ) : (
            <p className="font-sans text-sm text-muted-foreground">
              Only the workspace owner can create and delete agent tokens.
            </p>
          )}
        </Panel>
      )}

      {!flash && connectData && mcpUrl && !live && (
        <Panel title="Connect an agent" meta="MCP over HTTPS">
          <p className="mb-4 font-sans text-sm leading-6 text-muted-foreground">
            Point any MCP-compatible agent at the endpoint below. Token secrets are shown only once when created;
            create a new token to connect another agent.
          </p>
          <ConnectAgent mcpUrl={mcpUrl} />
        </Panel>
      )}

      {live && status && (
        <div className="grid gap-4">
          <div className="rounded-2xl bg-brand-bright/5 px-5 pb-5 pt-4">
            <p className="font-sans text-sm leading-6 text-muted-foreground">
              This is your included free publish. People with the link can read it now; search engines won&apos;t index it
              until you upgrade.
            </p>
            {livePost && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-background/60 px-3 py-2.5">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Live URL
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{livePost.url}</span>
                <a
                  href={livePost.url}
                  target="_blank"
                  rel="noopener"
                  className="font-sans text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open post
                </a>
                <CopyButton value={livePost.url} label="Copy URL" copiedLabel="Copied" iconOnly />
              </div>
            )}
          </div>

          <Panel title="Continue publishing">
            <UpgradeCtas checkoutPending={checkoutPending} onCheckout={startCheckout} />
          </Panel>
        </div>
      )}
    </>
  )
}
