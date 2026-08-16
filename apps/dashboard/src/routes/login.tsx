import { createFileRoute } from '@tanstack/react-router'
import { BRAND, LEGAL } from '@vc/config'
import { AuthForm } from '~/components/AuthForm'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { googleEnabled, githubEnabled } = Route.useRouteContext()

  return (
    <main className="flex min-h-svh flex-col bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <header className="space-y-5">
          <a
            href={BRAND.marketingUrl}
            className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold tracking-[-0.02em] text-foreground no-underline"
          >
            <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />
            {BRAND.name}
          </a>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
              Sign in
            </h1>
            <p className="text-pretty font-sans text-sm leading-6 text-muted-foreground">
              We&apos;ll email you a one-time code. No password needed.
            </p>
            <p className="font-mono text-[11px] leading-5 text-muted-foreground/70">
              {'// your agent never sees this login'}
            </p>
          </div>
        </header>
        <AuthForm googleEnabled={googleEnabled} githubEnabled={githubEnabled} />
      </div>
      <nav
        aria-label="Legal"
        className="mx-auto flex w-full max-w-sm items-center justify-center gap-2 pt-8 font-mono text-[12px] text-muted-foreground"
      >
        {(
          [
            ['Privacy', LEGAL.privacy],
            ['Terms', LEGAL.terms],
            ['Support', LEGAL.support],
          ] as const
        ).map(([label, path], index) => (
          <span key={label} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground/40">
                ·
              </span>
            ) : null}
            <a
              href={`${BRAND.marketingUrl}${path}`}
              className="inline-flex min-h-[44px] items-center rounded-md px-2 underline-offset-4 hover:text-foreground hover:underline"
            >
              {label}
            </a>
          </span>
        ))}
      </nav>
    </main>
  )
}
