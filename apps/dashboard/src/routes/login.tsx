import { createFileRoute } from '@tanstack/react-router'
import { BRAND, LEGAL } from '@vc/config'
import { useEffect } from 'react'
import { AuthForm } from '~/components/AuthForm'
import { clearSessionSecrets } from '~/lib/token-flash'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { googleEnabled, githubEnabled } = Route.useRouteContext()

  // Whoever signs in next in this tab must never see the previous session's one-time key.
  useEffect(() => clearSessionSecrets(), [])

  return (
    <main className="flex min-h-svh flex-col bg-background px-5 py-8 text-foreground">
      <a
        href={BRAND.marketingUrl}
        className="mx-auto inline-flex min-h-11 w-full max-w-sm items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.02em] text-foreground no-underline"
      >
        <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />
        {BRAND.name}
      </a>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <AuthForm googleEnabled={googleEnabled} githubEnabled={githubEnabled} />
      </div>
      <nav aria-label="Legal" className="mx-auto flex w-full max-w-sm items-center justify-center gap-1 text-sm text-muted-foreground">
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
            className="inline-flex min-h-11 items-center rounded-md px-2.5 underline-offset-4 hover:text-foreground hover:underline"
          >
            {label}
          </a>
        ))}
      </nav>
    </main>
  )
}
