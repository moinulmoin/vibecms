import { FREE_TIER, LAUNCH_OFFER } from '@vc/config'
import { CopyButton, Skeleton } from '@vc/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, LoadError } from '~/components/dashboard/DashboardLayout'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { AgentSetup, FirstPostPrompt, clientFromPreference, type AgentClient } from '~/components/dashboard/ConnectAgent'
import { createApiKeyMutation, savePersonalizationMutation } from '~/lib/api-client'
import { emptyDashboardStatusSearch, emptyPostEditorSearch } from '~/lib/dashboard-search'
import { connectQuery, onboardingStatusQuery, queryKeys } from '~/lib/queries'
import { consumeTokenFlash, saveTokenFlash, type TokenFlash } from '~/lib/token-flash'
import type { OnboardingConnectStatus } from '~/types/dashboard'

const STEP = { current: 2, total: 2 }

function Waiting({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-[0.9375rem] text-muted-foreground">
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-bright/60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-brand-bright" />
      </span>
      {label}
    </p>
  )
}

/** Live status for the first post, polled while the user works in their agent. */
export function FirstPostStatus({ status }: { status: OnboardingConnectStatus | undefined }) {
  if (!status) return <Waiting label="Watching for your agent…" />
  const first = status.firstPost
  if (first.state === 'live') {
    return (
      <div className="grid gap-4">
        <p className="flex items-center gap-2.5 text-[0.9375rem] font-medium text-foreground">
          <Check aria-hidden className="size-4 text-primary" /> Your first post is live.
        </p>
        {first.post.url ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
            <a
              href={first.post.url}
              target="_blank"
              rel="noopener"
              className="min-w-0 flex-1 truncate font-mono text-sm text-foreground underline-offset-4 hover:underline"
            >
              {first.post.url}
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
    )
  }
  if (first.state === 'draft') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[0.9375rem] text-foreground">
          Your agent wrote a draft: <span className="font-medium">{first.post.title}</span>
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/posts/$postId/edit" params={{ postId: first.post.id }} search={emptyPostEditorSearch}>
            Review it
          </Link>
        </Button>
      </div>
    )
  }
  if (status.connection === 'connected') return <Waiting label="Agent connected. Waiting for its first draft…" />
  return <Waiting label="Watching for your agent…" />
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

  async function createKey() {
    setCreating(true)
    setKeyError(false)
    try {
      const result = await createApiKeyMutation({ name: 'My agent', actorName: 'My agent', preset: 'publish' })
      if (result.kind !== 'ok') {
        setKeyError(true)
        return
      }
      const next = { token: result.token, name: result.name, id: result.id }
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

  return (
    <OnboardingFrame
      step={live ? undefined : STEP}
      title={live ? 'You’re all set' : 'Connect your agent'}
      description={
        live
          ? 'Your agent can draft and publish here. You review and approve.'
          : 'Copy one command into your agent, then paste the prompt. Watch your first post arrive here.'
      }
    >
      {!connect.data ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : (
        <div className="grid gap-10">
          {!live ? (
            <>
              <section className="grid gap-4" aria-labelledby="onboarding-add">
                <h2 id="onboarding-add" className="text-base font-semibold text-foreground">
                  1. Add vibecms to your agent
                </h2>
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
                  <p className="text-sm text-muted-foreground">
                    Your key is in the command. It won’t be shown again, so keep this tab open until you’ve pasted it.
                  </p>
                ) : null}
              </section>

              <section className="grid gap-4" aria-labelledby="onboarding-try">
                <h2 id="onboarding-try" className="text-base font-semibold text-foreground">
                  2. Ask for your first post
                </h2>
                <FirstPostPrompt />
              </section>
            </>
          ) : null}

          <section aria-live="polite" className="grid gap-4 border-t border-[color:var(--hairline)] pt-6">
            <FirstPostStatus status={status.data} />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {live ? (
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                The free plan includes {FREE_TIER.publishedPosts} published posts. Unlimited publishing, images, and your own domain are{' '}
                {LAUNCH_OFFER.monthlyLabel} during early access.
              </p>
            ) : (
              <span />
            )}
            <Button asChild variant={live ? 'default' : 'ghost'}>
              <Link to="/dashboard" search={emptyDashboardStatusSearch}>
                {live ? 'Go to your dashboard' : 'Skip for now'}
                {live ? <ArrowRight aria-hidden data-icon="inline-end" /> : null}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </OnboardingFrame>
  )
}
