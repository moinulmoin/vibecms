import { createFileRoute, redirect } from '@tanstack/react-router'
import { contextQuery, queryClient } from '~/lib/queries'
import { BRAND, FREE_TIER, LEGAL } from '@vc/config'
import { Bot, Check, Globe } from 'lucide-react'
import { useEffect } from 'react'
import { AuthForm, type AuthIntent } from '~/components/AuthForm'
import { clearSessionSecrets } from '~/lib/token-flash'

type LoginSearch = { intent?: AuthIntent }

export const Route = createFileRoute('/login')({
  // "Start free" links from the site arrive with ?intent=start.
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    search.intent === 'start' ? { intent: 'start' } : {},
  // Already signed in: go to the dashboard instead of showing the sign-in form.
  // Ask the server, not the cache: an expired session lands here with a stale
  // cached context, and must see the form rather than bounce back.
  beforeLoad: async () => {
    const fresh = await queryClient.fetchQuery({ ...contextQuery, staleTime: 0 }).catch(() => null)
    if (fresh?.app) throw redirect({ to: '/dashboard' })
  },
  component: LoginPage,
})

/** The loop people are signing up for: agent drafts, you approve, it's live. */
function HowItWorks() {
  const steps = [
    { Icon: Bot, title: 'Your agent drafts', detail: 'From Claude Code, Codex, Cursor, or any MCP client.' },
    { Icon: Check, title: 'You approve', detail: 'Read the private preview. Nothing goes live without you.' },
    { Icon: Globe, title: 'It’s live', detail: 'On your own blog, with every version kept.' },
  ]
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="text-sm font-medium text-muted-foreground">How it works</p>
      <ol className="mt-5 grid gap-5">
        {steps.map(({ Icon, title, detail }, index) => (
          <li key={title} className="relative flex gap-3.5">
            {index < steps.length - 1 ? (
              <span aria-hidden className="absolute left-4 top-9 h-[calc(100%-0.75rem)] w-px bg-border" />
            ) : null}
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-primary"
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block text-[0.9375rem] font-medium text-foreground">{title}</span>
              <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-6 border-t border-[color:var(--hairline)] pt-4 text-sm text-muted-foreground">
        Free to try, no card. Your first {FREE_TIER.publishedPosts} posts are on us.
      </p>
    </div>
  )
}

function LoginPage() {
  const { googleEnabled, githubEnabled } = Route.useRouteContext()
  const { intent } = Route.useSearch()

  // Whoever signs in next in this tab must never see the previous session's one-time key.
  useEffect(() => clearSessionSecrets(), [])

  return (
    <div className="relative isolate min-h-svh overflow-x-clip bg-background text-foreground">
      <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        <a
          href={BRAND.marketingUrl}
          className="inline-flex min-h-11 w-fit items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.02em] text-foreground no-underline"
        >
          <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />
          {BRAND.name}
        </a>
        <div className="grid flex-1 content-center items-center gap-12 py-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,22rem)] lg:justify-between lg:gap-16">
          <div className="mx-auto w-full max-w-sm lg:mx-0">
            <AuthForm googleEnabled={googleEnabled} githubEnabled={githubEnabled} intent={intent} />
          </div>
          <aside aria-label="How vibecms works" className="hidden lg:block">
            <HowItWorks />
          </aside>
        </div>
        <nav aria-label="Legal" className="flex items-center justify-center gap-1 text-sm text-muted-foreground lg:justify-start">
          {(
            [
              ['Privacy', LEGAL.privacy],
              ['Terms', LEGAL.terms],
              ['Support', LEGAL.support],
            ] as const
          ).map(([label, path]) => (
            <a
              key={label}
              href={`${BRAND.marketingUrl}${path}`}
              className="inline-flex min-h-11 items-center rounded-md px-2.5 underline-offset-4 first:-ml-2.5 hover:text-foreground hover:underline"
            >
              {label}
            </a>
          ))}
        </nav>
      </main>
    </div>
  )
}
