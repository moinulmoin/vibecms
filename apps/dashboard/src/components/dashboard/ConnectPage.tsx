'use client'

import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { MEDIA, PRICING } from '@vc/config'
import type { Scope } from '@vc/core'
import {
  Badge,
  CopyButton,
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
} from '@vc/ui'
import { CheckIcon, Link2Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { Button, EmptyState, LoadError, PageHeader, Panel, formatDate } from '~/components/dashboard/DashboardLayout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { Skeleton } from '@vc/ui'
import type { ApiKeyListItem } from '~/types/dashboard'
import { ConnectAgent } from '~/components/dashboard/ConnectAgent'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Spinner } from '~/components/ui/spinner'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import {
  checkoutBillingMutation,
  createApiKeyMutation,
  loadConnectPage,
  loadOnboardingStatus,
  revokeApiKeyMutation,
} from '~/lib/api-client'
import type { ConnectPageData, OnboardingConnectStatus } from '~/types/dashboard'
import {
  dashboardStatusSearch,
  emptyDashboardStatusSearch,
  emptyPostEditorSearch,
} from '~/lib/dashboard-search'
import {
  clearActivationKeyId,
  clearTokenFlash,
  consumeTokenFlash,
  getActivationKeyId,
  saveTokenFlash,
} from '~/lib/token-flash'
import { isOnboardingActivationComplete } from '~/lib/connect-onboarding'
import { resolveDisplayConnection, shouldClearMissingActivationKey } from './connect-display'

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
function isScope(value: string): value is Scope {
  return (
    value === 'sites:read' ||
    value === 'posts:read' ||
    value === 'posts:create' ||
    value === 'posts:update' ||
    value === 'posts:publish' ||
    value === 'posts:archive' ||
    value === 'assets:write' ||
    value === 'activity:read'
  )
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

function scopeTooltip(label: string): string {
  if (label === 'Publisher') {
    return 'Everything Drafter allows, plus publishing posts live.'
  }
  if (label === 'Full publisher') {
    return 'Everything Publisher allows, plus archiving posts.'
  }
  return 'Can create and edit drafts and upload media.'
}

function TokenRow({
  apiKey,
  pending,
  onDelete,
}: {
  apiKey: ApiKeyListItem
  pending: boolean
  onDelete: (keyId: string) => Promise<void>
}) {
  const label = capabilityLabel(apiKey.scopes.filter(isScope))
  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0">
          <strong className="font-display text-sm font-semibold text-foreground">{apiKey.name}</strong>
          <p className="mt-0.5 font-mono text-xs text-primary">{apiKey.tokenPrefix}</p>
        </div>
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" tabIndex={0} className="cursor-help">
              {label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">{scopeTooltip(label)}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {formatDate(apiKey.createdAt)}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <CopyButton value={apiKey.tokenPrefix} iconOnly label="Copy token prefix" copiedLabel="Copied" />
          <SpaConfirmButton
            size="sm"
            confirmLabel="Confirm revoke"
            pendingLabel="Revoking..."
            helperText="Revoking blocks this token immediately. It stays in activity and audit history."
            disabled={pending}
            onConfirm={() => onDelete(apiKey.id)}
          >
            <TrashIcon aria-hidden data-icon="inline-start" /> Revoke token
          </SpaConfirmButton>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ConnectPage() {
  const navigate = useNavigate()

  const [connectData, setConnectData] = useState<ConnectPageData | null>(null)
  const [status, setStatus] = useState<OnboardingConnectStatus | null>(null)
  const [flash, setFlashState] = useState<{ token: string; name: string; id?: string } | null>(null)
  // Mirror flash in a ref so the once-mounted poll closure observes the latest reveal
  // without restarting the poll loop when the one-time token flash appears or is dismissed.
  const flashRef = useRef(flash)
  const setFlash = (value: { token: string; name: string; id?: string } | null) => {
    flashRef.current = value
    setFlashState(value)
  }
  const [createPending, setCreatePending] = useState(false)
  const [revokePending, setRevokePending] = useState<string | null>(null)
  const [checkoutPending, setCheckoutPending] = useState<'monthly' | 'yearly' | null>(null)
  // null = no explicit choice yet; the effective tab falls back to the state-derived default.
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [connectLoadFailed, setConnectLoadFailed] = useState(false)
  const [statusLoadFailed, setStatusLoadFailed] = useState(false)
  const tokenRevealRef = useRef<HTMLDivElement>(null)
  const activeTokenCountRef = useRef(0)
  const mcpUrl = connectData?.mcpUrl ?? status?.mcpUrl ?? ''

  const waitingStartedAtRef = useRef<number | null>(null)
  const lastSubRef = useRef<string>('')
  const stickyConnectedRef = useRef(false)
  const selectedKeyMissCountRef = useRef(0)

  async function refreshTokens() {
    try {
      const data = await loadConnectPage()
      activeTokenCountRef.current = data.apiKeys.length
      setConnectData(data)
      setConnectLoadFailed(false)
    } catch {
      // Keep stale list; the status toast surfaces the failure.
      setConnectLoadFailed(true)
    }
  }

  // Mount: restore a one-time reveal from sessionStorage (reload fallback) and load the token list.
  useEffect(() => {
    setFlash(consumeTokenFlash())
    void refreshTokens()
  }, [])

  // Creation is a security-sensitive moment. Bring the one-time reveal into view and
  // move focus to its labeled region without stealing focus during ordinary status polls.
  useEffect(() => {
    if (flash && mcpUrl) {
      tokenRevealRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      tokenRevealRef.current?.focus()
    }
  }, [flash, mcpUrl])

  // Poll the connection/first-post status. Monotonic + terminal-sticky: once connected,
  // the display never regresses to waiting; polling stops only after this agent publishes.
  useEffect(() => {
    let cancelled = false
    let timerId: number | undefined

    async function poll() {
      if (cancelled) return
      try {
        const storedKeyId = getActivationKeyId()
        const s = await loadOnboardingStatus({
          keyId: storedKeyId ?? undefined,
        })
        if (cancelled) return
        setStatusLoadFailed(false)

        // A fresh reveal bridges short D1 propagation lag, but cannot pin a
        // missing exact key forever. After four consecutive misses, clear the
        // stale selection so the next poll can fall back to the site's latest key.
        if (storedKeyId && s.key === null) {
          selectedKeyMissCountRef.current += 1
          const freshFlashMatches = flashRef.current?.id === storedKeyId
          if (shouldClearMissingActivationKey(freshFlashMatches, selectedKeyMissCountRef.current)) {
            clearActivationKeyId()
            selectedKeyMissCountRef.current = 0
          }
        } else {
          selectedKeyMissCountRef.current = 0
        }

        if (s.connection === 'connected') stickyConnectedRef.current = true

        if (s.connection === 'waiting') {
          if (waitingStartedAtRef.current === null) waitingStartedAtRef.current = Date.now()
        } else {
          waitingStartedAtRef.current = null
        }

        const displayConn = resolveDisplayConnection(
          s.connection,
          flashRef.current !== null,
          stickyConnectedRef.current,
          activeTokenCountRef.current,
          storedKeyId === s.key?.id && s.connection === 'revoked',
        )
        const elapsedMs = waitingStartedAtRef.current ? Date.now() - waitingStartedAtRef.current : 0
        const sub = getSub(displayConn, elapsedMs)

        // Once activation is complete (live), connection announcements are stale.
        const live = isOnboardingActivationComplete(s.firstPost)
        const subKey = live
          ? '__live__'
          : `${displayConn}|${s.firstPost.state}|${sub ?? ''}`
        if (subKey !== lastSubRef.current) {
          lastSubRef.current = subKey
          if (live) {
            setAnnouncement('')
          } else {
            const msg = announcementFor(sub)
            if (msg) setAnnouncement(msg)
          }
        }

        setStatus(s)

        if (!live) {
          const interval = stickyConnectedRef.current ? 5_000 : 3_000
          timerId = window.setTimeout(poll, interval)
        }
      } catch {
        if (!cancelled) {
          setStatusLoadFailed(true)
          timerId = window.setTimeout(poll, 5_000)
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timerId)
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
        name: String(form.get('name') ?? 'My agent'),
        actorName: String(form.get('actorName') ?? 'My agent'),
        preset,
      })
      if (result.kind === 'ok') {
        saveTokenFlash({ token: result.token, name: result.name, id: result.id })
        setFlash({ token: result.token, name: result.name, id: result.id })
        // The token exists locally right now. Start the waiting clock immediately and
        // announce waiting so users hear a useful state before the first poll lands.
        waitingStartedAtRef.current = Date.now()
        setAnnouncement(announcementFor('waiting'))
        await refreshTokens()
        await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ ok: 'token_created' }) })
        return
      }
      await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ error: result.code }) })
    } catch {
      await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ error: 'unknown' }) })
    } finally {
      setCreatePending(false)
    }
  }

  async function handleDelete(keyId: string) {
    setRevokePending(keyId)
    stickyConnectedRef.current = false
    try {
      const result = await revokeApiKeyMutation({ keyId })
      await refreshTokens()
      await navigate({
        to: '/dashboard/connect',
        search: dashboardStatusSearch(result.kind === 'ok' ? { ok: result.code } : { error: result.code }),
      })
    } catch {
      await navigate({ to: '/dashboard/connect', search: dashboardStatusSearch({ error: 'unknown' }) })
    } finally {
      setRevokePending(null)
    }
  }

  async function startCheckout(interval: 'monthly' | 'yearly') {
    setCheckoutPending(interval)
    try {
      const result = await checkoutBillingMutation({ interval })
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

  const live = isOnboardingActivationComplete(status?.firstPost)
  const draft = status?.firstPost.state === 'draft' ? status.firstPost : null
  const livePost = status?.firstPost.state === 'live' ? status.firstPost.post : null
  const liveActorName = status?.firstPost.state === 'live' ? status.firstPost.actorName : null
  const apiKeys = connectData?.apiKeys ?? []
  const defaultTab = live && apiKeys.length > 0 ? 'tokens' : 'setup'
  const effectiveTab = activeTab ?? defaultTab
  const selectedKeyId = getActivationKeyId()
  const displayConn = resolveDisplayConnection(
    status?.connection,
    flash !== null,
    stickyConnectedRef.current,
    apiKeys.length,
    selectedKeyId === status?.key?.id && status?.connection === 'revoked',
  )

  const elapsedMs = waitingStartedAtRef.current ? Date.now() - waitingStartedAtRef.current : 0
  const selfTestSub = getSub(displayConn, elapsedMs)
  const showSelfTest =
    !live &&
    status !== null &&
    (displayConn === 'revoked' ||
      (!draft && (displayConn === 'waiting' || displayConn === 'connected')))

  const canManage = connectData?.canManage ?? status?.canManage ?? false
  const loading = !connectData && !status
  const showInitialError = loading && connectLoadFailed && statusLoadFailed

  const pageKicker = live ? 'Complete' : 'Activation'
  const pageTitle = live
    ? 'Your first post is live'
    : draft
      ? 'Agent draft ready for review'
      : displayConn === 'connected'
        ? 'Agent connected'
        : flash !== null
          ? 'Token created'
          : 'Connect your agent'
  const pageDesc = live
    ? 'Your agent published successfully. Open the article, copy its URL, or continue to your dashboard.'
    : draft
      ? 'Your agent saved a draft. Review it, then approve publishing when you are ready.'
      : displayConn === 'connected'
        ? 'Your agent authenticated. Ask it to prepare a draft, then approve publishing when you are ready.'
        : flash !== null
          ? 'Copy the token and config below now. It is shown only once.'
          : 'Create one scoped token, connect any compatible MCP agent, and verify the connection here.'

  return (
    <TooltipProvider>
      <noscript>
        <p className="rounded-xl bg-muted p-4 font-sans text-sm text-muted-foreground">
          vibecms needs JavaScript to manage tokens and detect your agent. Enable JavaScript and refresh this page.
        </p>
      </noscript>

      <div role="status" aria-live="polite" className="sr-only">
        {live ? '' : announcement}
      </div>

      {showInitialError ? (
        <LoadError message="Could not load connect status. Check your connection and try again." />
      ) : (
        <>
          <PageHeader
            kicker={effectiveTab === 'tokens' ? 'Access' : pageKicker}
            title={effectiveTab === 'tokens' ? 'API tokens' : pageTitle}
            description={
              effectiveTab === 'tokens'
                ? 'Create and manage scoped tokens that connect MCP agents to this blog.'
                : pageDesc
            }
            action={
              live ? (
                <Button asChild>
                  <Link to="/dashboard" search={emptyDashboardStatusSearch}>
                    Continue to Overview
                  </Link>
                </Button>
              ) : undefined
            }
          />

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

          {!loading && (
            <Tabs value={effectiveTab} onValueChange={setActiveTab} className="w-full">
              <TabsList>
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="tokens">Tokens</TabsTrigger>
              </TabsList>

              <TabsContent value="setup" className="mt-4 space-y-4">
                {live && status && (
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
                    <Panel title="Publication proof">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
                        {livePost && (
                          <div className="grid gap-1">
                            <p className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                              {livePost.title}
                            </p>
                            {liveActorName && (
                              <p className="font-sans text-sm text-muted-foreground">
                                Published by {liveActorName}
                              </p>
                            )}
                          </div>
                        )}
                        <p className="font-sans text-base leading-7 text-muted-foreground">
                          {livePost?.url
                            ? "Your first 5 published posts are free. People with the link can read it now; search engines won't index it until you upgrade."
                            : 'The publish is recorded. The public link will appear when the default domain is active.'}
                        </p>
                        {livePost?.url && (
                          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--hairline)] px-3 py-2.5">
                            <span className="min-w-0 flex-1 truncate font-mono text-base text-foreground sm:text-lg">
                              {livePost.url}
                            </span>
                            <a
                              href={livePost.url}
                              target="_blank"
                              rel="noopener"
                              className="font-sans text-sm font-medium text-primary underline-offset-4 hover:underline"
                            >
                              Open article
                            </a>
                            <CopyButton value={livePost.url} label="Copy link" copiedLabel="Copied" iconOnly />
                          </div>
                        )}
                      </div>
                    </Panel>

                    <Panel title="Publish more posts">
                      <UpgradeCtas checkoutPending={checkoutPending} onCheckout={startCheckout} />
                    </Panel>
                  </div>
                )}

                {flash && mcpUrl && displayConn !== 'revoked' && (
                  <div ref={tokenRevealRef} tabIndex={-1} aria-label="Your token is ready">
                    <Panel title="Your token is ready">
                      <div className="mb-4 rounded-xl bg-muted p-3 font-sans text-sm leading-6 text-foreground">
                        Copy this token now. For security it is shown only once and cannot be retrieved later.
                      </div>
                      <ConnectAgent
                        mcpUrl={mcpUrl}
                        token={flash.token}
                        tokenName={flash.name}
                        connected={displayConn === 'connected'}
                      />
                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            clearTokenFlash()
                            setFlash(null)
                          }}
                        >
                          I&apos;ve copied it - hide
                        </Button>
                      </div>
                    </Panel>
                  </div>
                )}

                {showSelfTest && selfTestSub && (
                  <Panel title="Connection status">
                    <div className="grid gap-3">
                      <div
                        className={[
                          'flex items-start gap-2 rounded-xl p-3 font-sans text-sm leading-5',
                          selfTestSub === 'revoked'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-muted/50 text-foreground',
                        ].join(' ')}
                      >
                        {selfTestSub === 'waiting' && (
                          <Spinner aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 motion-reduce:animate-none" />
                        )}
                        {selfTestSub === 'connected' && (
                          <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        )}
                        <span>
                          {selfTestSub === 'waiting' && 'Waiting for your agent to connect...'}
                          {selfTestSub === 'stalled' &&
                            "Still waiting. Some MCP clients don't call tools until you ask. Run the read-only check below."}
                          {selfTestSub === 'recovery' &&
                            'Not detected yet. Check the token, the MCP URL, and the Authorization: Bearer header, or create a new token.'}
                          {selfTestSub === 'connected' &&
                            'Connected. vibecms saw your agent authenticate. Run the read-only check, then ask your agent to prepare a draft.'}
                          {selfTestSub === 'revoked' &&
                            "This token can't be used anymore. Create a new token below to connect an agent."}
                        </span>
                      </div>
                    </div>
                  </Panel>
                )}

                {draft && (
                  <Panel title="Agent draft ready for review">
                    <div className="grid gap-3">
                      <p className="font-sans text-sm leading-6 text-muted-foreground">
                        Your agent saved a draft. Review it, then approve publishing when you are ready.
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--hairline)] px-3 py-2.5">
                        <div className="min-w-0">
                          <strong className="truncate font-display font-semibold text-foreground">
                            <Link
                              className="no-underline hover:underline"
                              to="/dashboard/posts/$postId/edit"
                              params={{ postId: draft.post.id }}
                              search={emptyPostEditorSearch}
                            >
                              {draft.post.title}
                            </Link>
                          </strong>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            Version {draft.post.versionNumber} · {formatDate(draft.post.updatedAt)}
                          </p>
                        </div>
                        <Button asChild variant="link" size="sm">
                          <Link
                            to="/dashboard/posts/$postId/edit"
                            params={{ postId: draft.post.id }}
                            search={emptyPostEditorSearch}
                          >
                            Review draft
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </Panel>
                )}

                {connectData && canManage && (
                  <Panel title="Create a token">
                    <form className="grid gap-4" onSubmit={(e) => void handleCreate(e)}>
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
                        <RadioGroup name="preset" defaultValue="publish" className="grid gap-2 sm:grid-cols-3">
                          {TOKEN_PRESETS.map((preset) => (
                            <label
                              key={preset.id}
                              htmlFor={`preset-${preset.id}`}
                              className="flex cursor-pointer items-start gap-3 rounded-xl bg-background/60 p-3 transition-colors hover:bg-background has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-brand-bright/40"
                            >
                              <RadioGroupItem id={`preset-${preset.id}`} value={preset.id} className="mt-0.5" />
                              <span>
                                <span className="flex items-center gap-1.5 font-display text-sm font-medium text-foreground">
                                  {preset.label}
                                  {preset.recommended && (
                                    <span className="font-mono text-[0.6rem] text-primary">default</span>
                                  )}
                                </span>
                                <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">
                                  {preset.description}
                                </span>
                              </span>
                            </label>
                          ))}
                        </RadioGroup>
                      </FieldSet>
                      <PendingSubmitButton className="w-fit" pending={createPending} pendingText="Creating...">
                        <PlusIcon aria-hidden data-icon="inline-start" /> Create token
                      </PendingSubmitButton>
                    </form>
                  </Panel>
                )}

                {!flash && connectData && mcpUrl && !live && apiKeys.length > 0 && !showInitialError && (
                  <Panel title="Connect an agent" meta="MCP over HTTPS">
                    <p className="mb-4 font-sans text-sm leading-6 text-muted-foreground">
                      Use a token you saved previously. Token secrets are shown only once; create a new token to
                      connect another agent.
                    </p>
                    <ConnectAgent mcpUrl={mcpUrl} connected={displayConn === 'connected'} />
                  </Panel>
                )}
              </TabsContent>

              <TabsContent value="tokens" className="mt-4 space-y-4">
                {connectData && (
                  <Panel
                    title="API tokens"
                    meta={canManage ? `${apiKeys.length} active` : 'Owner access required'}
                  >
                    {canManage ? (
                      apiKeys.length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Scopes</TableHead>
                              <TableHead>Created</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {apiKeys.map((key) => (
                              <TokenRow
                                key={key.id}
                                apiKey={key}
                                pending={revokePending === key.id}
                                onDelete={handleDelete}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <EmptyState
                          icon={<Link2Icon />}
                          title="No agent connected yet"
                          description="Create a token above to connect an AI agent to this blog over MCP."
                        />
                      )
                    ) : (
                      <p className="font-sans text-sm text-muted-foreground">
                        Only the workspace owner can create and delete agent tokens.
                      </p>
                    )}
                  </Panel>
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </TooltipProvider>
  )
}
