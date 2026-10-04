import { FREE_TIER, LAUNCH_OFFER } from '@vc/config'
import { CopyButton, Skeleton } from '@vc/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, LoadError } from '~/components/dashboard/DashboardLayout'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { AgentSetup, CodeBlock, clientFromPreference, type AgentClient } from '~/components/dashboard/ConnectAgent'
import { createApiKeyMutation, savePersonalizationMutation } from '~/lib/api-client'
import { emptyDashboardStatusSearch, emptyPostEditorSearch } from '~/lib/dashboard-search'
import { connectQuery, onboardingStatusQuery, queryKeys } from '~/lib/queries'
import { clearTokenFlash, consumeTokenFlash, isRevealedKeyGone, saveTokenFlash, type TokenFlash } from '~/lib/token-flash'
import type { OnboardingConnectStatus } from '~/types/dashboard'

const STEP = { current: 2, total: 2 }
const FIRST_DRAFT_PROMPT = 'Use vibecms to write a short first post for my blog: a friendly hello that says what this blog will be about. Save it as a draft and send me the private preview link. Don’t publish until I say so.'

type StepState = 'done' | 'active' | 'upcoming'

function StepIcon({ state, n }: { state: StepState; n: number }) {
  if (state === 'done') {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-bright text-brand-bright-foreground">
        <Check aria-hidden className="size-3.5" strokeWidth={3} />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="relative grid size-6 shrink-0 place-items-center">
        <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-brand-bright/25 motion-reduce:animate-none" />
        <span className="relative grid size-6 place-items-center rounded-full border-2 border-brand-bright bg-card text-[11px] font-semibold text-foreground">
          {n}
        </span>
      </span>
    )
  }
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-[11px] font-medium text-muted-foreground">
      {n}
    </span>
  )
}

function LiveStep({ n, state, title, detail }: { n: number; state: StepState; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <StepIcon state={state} n={n} />
      <div className="min-w-0 pt-0.5">
        <p className={state === 'upcoming' ? 'text-sm text-muted-foreground' : 'text-sm font-medium text-foreground'}>{title}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{detail}</p>
      </div>
    </li>
  )
}

/**
 * The live side of onboarding: key → agent connected → first draft, updated
 * every few seconds while the user works in their agent. When the draft lands
 * it becomes the moment to review it.
 */
export function FirstPostStatus({
  status,
  keyName,
  hasKey,
}: {
  status: OnboardingConnectStatus | undefined
  keyName?: string
  hasKey?: boolean
}) {
  const first = status?.firstPost
  if (first?.state === 'live') {
    return (
      <div className="overflow-hidden rounded-xl border border-brand-bright/40 bg-card shadow-[0_0_0_4px_var(--glow-primary)]">
        <div className="px-5 pb-5 pt-5">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Check aria-hidden className="size-4 text-brand-bright" strokeWidth={3} /> Your latest post is live.
          </p>
          <p className="mt-3 font-display text-lg font-semibold leading-snug tracking-[-0.02em] text-foreground">{first.post.title}</p>
          {first.post.url ? (
            <div className="mt-4 flex min-w-0 items-center gap-1 rounded-lg border border-border bg-muted/40 py-1 pl-3 pr-1">
              <a
                href={first.post.url}
                target="_blank"
                rel="noopener"
                className="min-w-0 flex-1 truncate font-mono text-xs text-foreground underline-offset-4 hover:underline"
              >
                {first.post.url.replace(/^https?:\/\//, '')}
              </a>
              <CopyButton value={first.post.url} label="Copy link" copiedLabel="Copied" iconOnly className="size-8" />
              <Button asChild variant="ghost" size="sm">
                <a href={first.post.url} target="_blank" rel="noopener">
                  <ExternalLink aria-hidden data-icon="inline-start" /> Open
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (first?.state === 'draft') {
    return (
      <div className="overflow-hidden rounded-xl border border-brand-bright/40 bg-card shadow-[0_0_0_4px_var(--glow-primary)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300">
        <div className="px-5 pb-5 pt-5">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-bright/12 px-2.5 py-1 text-xs font-medium text-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-brand-bright" /> Your first post is here
          </p>
          <p className="mt-4 font-display text-xl font-semibold leading-snug tracking-[-0.025em] text-foreground">{first.post.title}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Draft v{first.post.versionNumber} · written by {keyName ?? 'your agent'}
          </p>
          <Button asChild className="mt-5 w-full">
            <Link to="/dashboard/posts/$postId/edit" params={{ postId: first.post.id }} search={emptyPostEditorSearch}>
              Review your first post <ArrowRight aria-hidden data-icon="inline-end" />
            </Link>
          </Button>
          <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
            Nothing is live yet. Read it, then publish or schedule it when you’re happy.
          </p>
        </div>
      </div>
    )
  }

  const keyReady = Boolean(hasKey || status?.key)
  const connected = status?.connection === 'connected'
  const revoked = status?.connection === 'revoked'
  const steps: Array<{ title: string; detail: string; state: StepState }> = [
    {
      title: 'Key created',
      detail: keyReady ? `${keyName ?? 'My agent'} · can write drafts` : 'Making a key for your agent…',
      state: keyReady ? 'done' : 'active',
    },
    {
      title: connected ? 'Agent connected' : 'Connect your agent',
      detail: connected ? 'It can reach your blog.' : 'Run the command, then start your agent.',
      state: connected ? 'done' : keyReady ? 'active' : 'upcoming',
    },
    {
      title: 'First draft',
      detail: connected ? 'Paste the prompt. The draft shows up here.' : 'Ask for your first post.',
      state: connected ? 'active' : 'upcoming',
    },
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-3.5">
        <p className="text-sm font-medium text-foreground">Your agent</p>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-bright/60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-brand-bright" />
          </span>
          Watching live
        </span>
      </div>
      {revoked ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">This key was revoked. Create a new one in Connect to continue.</p>
      ) : (
        <ol className="grid gap-5 px-5 py-5">
          {steps.map((step, index) => (
            <LiveStep key={step.title} n={index + 1} {...step} />
          ))}
        </ol>
      )}
    </div>
  )
}

function SectionHeading({ n, id, children }: { n: number; id: string; children: string }) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 text-base font-semibold text-foreground">
      <span className="grid size-6 place-items-center rounded-full bg-foreground/[0.07] text-xs font-semibold tabular-nums text-foreground">{n}</span>
      {children}
    </h2>
  )
}

export function PersonalizePage() {
  const queryClient = useQueryClient()
  const connect = useQuery(connectQuery)
  const [flash, setFlash] = useState<TokenFlash | null>(null)
  const [client, setClient] = useState<AgentClient | null>(null)
  const [keyError, setKeyError] = useState(false)
  const [creating, setCreating] = useState(false)
  const autoCreated = useRef(false)

  useEffect(() => {
    const restored = consumeTokenFlash()
    if (restored) {
      setFlash(restored)
      saveTokenFlash(restored)
    }
  }, [])

  // A reveal whose key has since been deleted (here, in another tab, or by
  // onboarding) goes away instead of handing out a dead key.
  useEffect(() => {
    if (flash && connect.data && isRevealedKeyGone(flash, connect.data.apiKeys, connect.dataUpdatedAt)) {
      clearTokenFlash()
      setFlash(null)
    }
  }, [flash, connect.data, connect.dataUpdatedAt])

  async function createKey() {
    setCreating(true)
    setKeyError(false)
    try {
      const result = await createApiKeyMutation({ name: 'My agent', actorName: 'My agent', preset: 'draft' })
      if (result.kind !== 'ok') {
        setKeyError(true)
        return
      }
      const next = { token: result.token, name: result.name, id: result.id, createdAt: Date.now() }
      saveTokenFlash(next)
      setFlash(next)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connect })
    } catch {
      setKeyError(true)
    } finally {
      setCreating(false)
    }
  }

  // First visit: make the key for them. Returning visitors with keys choose to make another.
  useEffect(() => {
    if (!connect.data || flash || autoCreated.current) return
    if (!connect.data.canManage || connect.data.apiKeys.length > 0) return
    autoCreated.current = true
    void createKey()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect.data, flash])

  const status = useQuery({
    ...onboardingStatusQuery(flash?.id ?? null),
    refetchInterval: (query) => (query.state.data?.firstPost.state === 'live' ? false : 3000),
    refetchIntervalInBackground: false,
  })

  const live = status.data?.firstPost.state === 'live'
  const activeClient = client ?? clientFromPreference(connect.data?.personalization.agentPreference)

  function chooseClient(next: AgentClient) {
    setClient(next)
    if (connect.data?.canManage) void savePersonalizationMutation({ agentPreference: next }).catch(() => undefined)
  }

  if (connect.isError && !connect.data) {
    return (
      <OnboardingFrame step={STEP} title="Connect your agent">
        <LoadError message="This step didn’t load. Check your connection and try again." onRetry={() => void connect.refetch()} />
      </OnboardingFrame>
    )
  }

  const draft = status.data?.firstPost.state === 'draft'
  const keyName = flash?.name ?? status.data?.key?.name ?? undefined
  const panel = connect.data ? (
    <div className="grid gap-4">
      <div aria-live="polite">
        <FirstPostStatus status={status.data} keyName={keyName} hasKey={Boolean(flash)} />
      </div>
      {live ? (
        <>
          <Button asChild className="w-full">
            <Link to="/dashboard" search={emptyDashboardStatusSearch}>
              Go to your dashboard <ArrowRight aria-hidden data-icon="inline-end" />
            </Link>
          </Button>
          {!connect.data.effectiveEntitlement.effective ? (
            <p className="text-[13px] leading-5 text-muted-foreground">
              Free includes {FREE_TIER.publishedPosts} published posts, {FREE_TIER.drafts} drafts at a time, and {FREE_TIER.images} images. Unlimited posts, 5 GB media, analytics, your own domain, search indexing, and unlimited agent requests (fair use) are{' '}
              {LAUNCH_OFFER.monthlyLabel} at launch pricing.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  ) : null

  return (
    <OnboardingFrame
      step={live ? undefined : STEP}
      title={live ? 'You’re all set' : draft ? 'Your agent delivered' : 'Connect your agent'}
      description={
        live
          ? 'Your agent can draft here. You choose whether to give it publishing access.'
          : draft
            ? 'Its first draft is waiting for you. Nothing goes live until you say so.'
            : 'Add vibecms to your agent and ask for a first post. You’ll see it arrive on the right.'
      }
      aside={panel}
    >
      {!connect.data ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : live ? null : (
        <div className="grid gap-10">
          <section className="grid gap-4" aria-labelledby="onboarding-add">
            <SectionHeading n={1} id="onboarding-add">Add vibecms to your agent</SectionHeading>
            {flash ? (
              <AgentSetup mcpUrl={connect.data.mcpUrl} token={flash.token} client={activeClient} onClientChange={chooseClient} />
            ) : creating ? (
              <Skeleton className="h-36 rounded-lg" />
            ) : connect.data.canManage ? (
              <div className="grid gap-3 rounded-lg border border-border p-4">
                <p className="text-sm leading-6 text-muted-foreground">
                  {keyError
                    ? 'We couldn’t create a key just now.'
                    : 'Your earlier key is hidden for safety. Make a fresh one to get a ready-to-paste command.'}
                </p>
                <Button type="button" className="w-fit" onClick={() => void createKey()}>
                  {keyError ? 'Try again' : 'Create a key'}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ask the blog owner for an agent key.</p>
            )}
            {flash ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Your key is inside the command and won’t be shown again. Keep this tab open until you’ve pasted it.
              </p>
            ) : null}
          </section>

          <section className="grid gap-4" aria-labelledby="onboarding-try">
            <SectionHeading n={2} id="onboarding-try">Ask for your first post</SectionHeading>
            <CodeBlock label="Paste into your agent" code={FIRST_DRAFT_PROMPT} copyLabel="Copy prompt" />
            <p className="text-sm leading-6 text-muted-foreground">
              This key can save drafts. You approve and publish, or give an agent publishing access later in Connect.
            </p>
          </section>

          {!draft ? (
            <div>
              <Button asChild variant="ghost" className="-ml-3 text-muted-foreground">
                <Link to="/dashboard" search={emptyDashboardStatusSearch}>
                  Skip for now
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </OnboardingFrame>
  )
}
