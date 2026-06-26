'use client'

import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { MEDIA, PRICING } from '@vc/config'
import { CopyButton } from '@vc/ui'
import { CheckIcon } from '@radix-ui/react-icons'
import { Button, PageHeader, Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { Skeleton } from '~/components/ui/skeleton'
import { ConnectAgent } from '~/components/dashboard/ConnectAgent'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import {
  createApiKeyMutation,
  loadOnboardingStatus,
  type OnboardingConnectStatus,
} from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch, postEditorSearch } from '~/lib/dashboard-search'
import { consumeTokenFlash, saveTokenFlash } from '~/lib/token-flash'
import { checkoutBillingMutation } from '~/server/billing-page-fn'

// Computed once from constants; updates automatically when pricing changes.
const MONTHS_FREE = Math.round(12 - PRICING.annualUsd / PRICING.monthlyUsd)

function isTerminal(s: OnboardingConnectStatus): boolean {
  return s.publish?.state === 'live' || s.publish?.state === 'already_live' || s.connection === 'revoked'
}

type SelfTestSub = 'waiting' | 'stalled' | 'recovery' | 'connected' | 'revoked'

function getSub(s: OnboardingConnectStatus, elapsedMs: number): SelfTestSub {
  if (s.connection === 'revoked') return 'revoked'
  if (s.connection === 'connected') return 'connected'
  if (elapsedMs > 60_000) return 'recovery'
  if (elapsedMs > 20_000) return 'stalled'
  return 'waiting'
}

/** Text announced on aria-live transitions only (not every poll tick). */
function announcementFor(s: OnboardingConnectStatus, sub: SelfTestSub | null): string {
  if (s.publish?.state === 'live' || s.publish?.state === 'already_live') {
    return s.publish.actor === 'onboarding_agent'
      ? 'Your agent published your first live post.'
      : 'Your first post is live.'
  }
  if (sub === 'revoked') return "This token can't be used anymore. Generate a new publish token."
  if (sub === 'connected') return 'Connected. VibeCMS saw your agent authenticate. Now paste the publish prompt below.'
  if (sub === 'recovery') return 'Not detected yet. Check your configuration or write your first post manually.'
  if (sub === 'stalled') return "Still waiting. Some MCP clients don't call tools until you ask."
  return 'Waiting for your agent to connect...'
}

// ---------------------------------------------------------------------------
// Upgrade CTAs (reusable for live reveal and billing_required states)
// ---------------------------------------------------------------------------
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

      <div className="flex justify-center">
        <Button asChild variant="ghost" size="sm">
          <Link to="/app">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConnectPage
// ---------------------------------------------------------------------------
export function ConnectPage() {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()

  const [status, setStatus] = useState<OnboardingConnectStatus | null>(null)
  const [flash, setFlash] = useState<{ token: string; name: string } | null>(null)
  const [createPending, setCreatePending] = useState(false)
  const [checkoutPending, setCheckoutPending] = useState<'monthly' | 'yearly' | null>(null)
  const [dismissedSecretLoss, setDismissedSecretLoss] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  // Refs: do not trigger re-renders; safe to read in render (values stable within a tick).
  const waitingStartedAtRef = useRef<number | null>(null)
  const lastKeyRef = useRef<string>('')

  // ---------------------------------------------------------------------------
  // Polling effect - cancellable, stops on terminal states or unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    // Timer handle - ReturnType<typeof setTimeout> is the allowed exception.
    let timerId: ReturnType<typeof setTimeout> | undefined

    // Consume flash synchronously before first async load so the token is
    // available when the status arrives.
    setFlash(consumeTokenFlash())

    async function poll() {
      if (cancelled) return
      try {
        const s = await loadOnboardingStatus()
        if (cancelled) return

        // Track when we first entered the waiting state for stalled/recovery thresholds.
        if (s.connection === 'waiting') {
          if (waitingStartedAtRef.current === null) waitingStartedAtRef.current = Date.now()
        } else {
          waitingStartedAtRef.current = null
        }

        const elapsedMs = waitingStartedAtRef.current ? Date.now() - waitingStartedAtRef.current : 0
        const sub: SelfTestSub | null =
          s.connection === 'waiting' || s.connection === 'connected' || s.connection === 'revoked'
            ? getSub(s, elapsedMs)
            : null

        // Announce only on genuine state transitions, not every poll tick.
        const key = `${s.connection}|${s.publish?.state ?? ''}|${sub ?? ''}`
        if (key !== lastKeyRef.current) {
          lastKeyRef.current = key
          const msg = announcementFor(s, sub)
          if (msg) setAnnouncement(msg)
        }

        setStatus(s)

        if (!isTerminal(s)) timerId = setTimeout(poll, 3_000)
      } catch {
        // Silently retry; never expose raw errors to the user.
        if (!cancelled) timerId = setTimeout(poll, 3_000)
      }
    }

    void poll()
    return () => {
      cancelled = true
      clearTimeout(timerId)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async function handleCreate() {
    setCreatePending(true)
    try {
      const result = await createApiKeyMutation({
        data: { name: 'My agent', actorName: 'My agent', preset: 'publish' },
      })
      if (result.kind === 'ok') {
        saveTokenFlash({ token: result.token, name: result.name })
        setFlash({ token: result.token, name: result.name })
        setDismissedSecretLoss(false)
        await navigate({ to: '/app/connect', search: dashboardStatusSearch({ ok: 'token_created' }) })
        return
      }
      await navigate({ to: '/app/connect', search: dashboardStatusSearch({ error: result.code }) })
    } finally {
      setCreatePending(false)
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
      await navigate({ to: '/app/connect', search: dashboardStatusSearch({ error: 'checkout_failed' }) })
    } catch {
      await navigate({ to: '/app/connect', search: dashboardStatusSearch({ error: 'checkout_failed' }) })
    } finally {
      setCheckoutPending(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state (refresh-idempotent: computed purely from server status + flash)
  // ---------------------------------------------------------------------------
  const isLive = status?.publish?.state === 'live' || status?.publish?.state === 'already_live'

  // P0.4: token secret is gone (consumed flash was empty), key exists, not yet connected.
  const secretLost =
    status !== null &&
    status.onboardingKey !== null &&
    flash === null &&
    status.connection !== 'connected' &&
    !dismissedSecretLoss

  // Elapsed time within the current waiting window (re-computed each render; polls drive re-renders ~3 s).
  const elapsedMs = waitingStartedAtRef.current ? Date.now() - waitingStartedAtRef.current : 0
  const selfTestSub: SelfTestSub | null =
    status !== null &&
    (status.connection === 'waiting' || status.connection === 'connected' || status.connection === 'revoked')
      ? getSub(status, elapsedMs)
      : null

  // Show self-test when we have a connection state to report (not live, not P0.4, not billing).
  const showSelfTest =
    !isLive &&
    !secretLost &&
    status !== null &&
    (status.connection === 'waiting' || status.connection === 'connected' || status.connection === 'revoked')

  // ConnectAgent in full setup mode: agent just got a token, needs MCP config + prompt.
  const showSetup =
    !isLive && !secretLost && status !== null && status.connection === 'waiting' && flash !== null

  // ConnectAgent in prompt-only mode: agent connected, needs the publish task pasted.
  const showPrompt =
    !isLive &&
    !secretLost &&
    status !== null &&
    status.connection === 'connected' &&
    (status.publish === null || status.publish.state === 'none')

  // Live reveal data
  const livePost = status?.publish?.post
  const liveHeading =
    status?.publish?.actor === 'onboarding_agent'
      ? 'Your agent published your first live post.'
      : 'Your first post is live.'

  // PageHeader content varies by phase
  const pageKicker = isLive ? 'Live' : 'Connect'
  const pageTitle = isLive
    ? liveHeading
    : selfTestSub === 'connected'
    ? 'Agent connected'
    : flash !== null
    ? 'Your agent is ready'
    : 'Connect your agent'
  const pageDesc = isLive
    ? undefined
    : selfTestSub === 'connected'
    ? 'Paste the prompt below into your agent to publish your first post.'
    : flash !== null
    ? 'Copy the token and config below, then paste the starter prompt into your agent.'
    : 'Generate a publish token and point your AI agent at the blog over MCP.'

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* P2.1: noscript fallback - visible only when JS is disabled */}
      <noscript>
        <p className="rounded-xl bg-muted p-4 font-sans text-sm text-muted-foreground">
          VibeCMS onboarding requires JavaScript to create tokens and detect your agent. Enable JavaScript and refresh
          this page.
        </p>
      </noscript>

      {/* P1.5: aria-live region - announces only on state transitions, never every poll tick */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <PageHeader
        kicker={pageKicker}
        title={pageTitle}
        description={pageDesc}
        action={
          !isLive ? (
            <Button asChild variant="outline">
              <Link to="/app">Open dashboard</Link>
            </Button>
          ) : undefined
        }
      />

      <StatusAlert status={formStatus} />

      {/* Loading skeleton */}
      {!status && (
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

      {/* P0.4: token secret unavailable - key exists but secret is gone and agent not yet connected */}
      {secretLost && (
        <Panel title="Token secret unavailable">
          <div className="grid gap-3">
            <p className="font-sans text-sm leading-6 text-muted-foreground">
              For security we can't show that token again. Generate a new publish token and paste the new command into
              your agent.
            </p>
            <div className="flex flex-wrap gap-2">
              <PendingSubmitButton
                type="button"
                pending={createPending}
                pendingText="Creating..."
                onClick={() => void handleCreate()}
              >
                Generate new token
              </PendingSubmitButton>
              <Button type="button" variant="outline" onClick={() => setDismissedSecretLoss(true)}>
                I already copied it - keep checking
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {/* no_token state */}
      {!isLive && !secretLost && status?.connection === 'no_token' && (
        status.canManage ? (
          <Panel
            title="Generate a publish token"
            meta={
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Free</span>
            }
          >
            <div className="grid gap-3">
              <p className="font-sans text-sm leading-6 text-muted-foreground">
                Creates a scoped token your agent uses to connect and publish. Shown once - keep it somewhere safe.
              </p>
              <PendingSubmitButton
                type="button"
                pending={createPending}
                pendingText="Creating..."
                onClick={() => void handleCreate()}
              >
                Generate publish token
              </PendingSubmitButton>
            </div>
          </Panel>
        ) : (
          <Panel title="Create an agent token">
            <p className="font-sans text-sm leading-6 text-muted-foreground">
              Only the workspace owner can create agent tokens. Ask the owner to connect an agent.
            </p>
          </Panel>
        )
      )}

      {/*
        Full setup panel: shown when the token was just created (waiting + flash).
        Placed ABOVE the self-test so "the command above" in the waiting helper is accurate.
      */}
      {showSetup && status && (
        <Panel title="Set up your agent">
          <ConnectAgent mcpUrl={status.mcpUrl} token={flash?.token} tokenName={flash?.name} />
        </Panel>
      )}

      {/* Self-test status panel - waiting / stalled / recovery / connected / revoked */}
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
                // Spinner with reduced-motion opt-out; aria-hidden because the text is the announcement.
                <span
                  className="mt-0.5 inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              <span>
                {selfTestSub === 'waiting' &&
                  'Waiting for your agent to connect...'}
                {selfTestSub === 'stalled' &&
                  "Still waiting. Some MCP clients don't call tools until you ask. Paste this into your agent: Call sites.get on vibecms and tell me the blog name."}
                {selfTestSub === 'recovery' &&
                  'Not detected yet. Check the token starts with vc_live_, the MCP URL is copied exactly, and the header is Authorization: Bearer <token>. You can keep this open, generate a new token, or write your first post manually.'}
                {selfTestSub === 'connected' &&
                  'Connected. VibeCMS saw your agent authenticate. Now paste the publish prompt below.'}
                {selfTestSub === 'revoked' &&
                  "This token can't be used anymore. Generate a new publish token and paste the new command into your agent."}
              </span>
            </div>

            {selfTestSub === 'waiting' && (
              <p className="font-sans text-xs leading-5 text-muted-foreground">
                Run the command above, restart your agent if it asks, then start a new chat. We'll keep checking.
              </p>
            )}

            {/* Recovery / revoked: offer a new token */}
            {(selfTestSub === 'recovery' || selfTestSub === 'revoked') && (
              <div className="flex flex-wrap items-center gap-2">
                <PendingSubmitButton
                  type="button"
                  variant={selfTestSub === 'revoked' ? 'default' : 'outline'}
                  size="sm"
                  pending={createPending}
                  pendingText="Creating..."
                  onClick={() => void handleCreate()}
                >
                  Generate new token
                </PendingSubmitButton>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/*
        Prompt-only ConnectAgent: shown when the agent is connected but hasn't published yet.
        Placed BELOW the self-test so "paste the publish prompt below" in the connected message is accurate.
      */}
      {showPrompt && status && (
        <Panel title="Paste this into your agent">
          <ConnectAgent mcpUrl={status.mcpUrl} promptOnly />
        </Panel>
      )}

      {/* Live reveal */}
      {isLive && status && (
        <div className="grid gap-4">
          {/* Reveal card: kicker is in PageHeader; card shows body + URL row */}
          <div className="rounded-2xl border border-brand-bright/20 bg-brand-bright/5 px-5 pb-5 pt-4">
            <p className="font-sans text-sm leading-6 text-muted-foreground">
              This is your included free publish. People with the link can read it now; search engines won't index it
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
                  Open Post
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

      {/* P1.3: Skip / manual fallback - hidden after live reveal (which has its own CTA) */}
      {status && !isLive && (
        <div className="space-y-3">
          {/* Secondary: write manually (under troubleshooting, not equal-weight in hero) */}
          <div className="rounded-2xl bg-muted/50 px-4 py-3">
            <p className="font-sans text-sm">
              <Link
                to="/app/posts/new"
                search={postEditorSearch()}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Write your first post manually instead
              </Link>
            </p>
            <p className="mt-1 font-sans text-xs leading-5 text-muted-foreground">
              You can still connect an agent later. Your first manual publish is also the included free publish.
            </p>
          </div>

          {/* Tertiary: skip entirely */}
          <div className="flex justify-end">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link to="/app">Skip for now</Link>
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
