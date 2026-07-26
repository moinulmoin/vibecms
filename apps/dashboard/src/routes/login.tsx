import { createFileRoute } from '@tanstack/react-router'
import { BRAND } from '@vc/config'
import { AuthForm } from '~/components/AuthForm'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { googleEnabled } = Route.useRouteContext()

  return (
    <main className="flex min-h-svh flex-col bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <header className="space-y-5">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-[-0.02em] text-foreground no-underline"
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
          </div>
        </header>
        <AuthForm googleEnabled={googleEnabled} />
      </div>
    </main>
  )
}
