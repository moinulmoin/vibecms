import { createFileRoute } from '@tanstack/react-router'
import { CardContent, CardDescription, CardHeader } from '@vc/ui'
import { BRAND } from '@vc/config'
import { AuthForm } from '~/components/AuthForm'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { authUrl, googleEnabled } = Route.useRouteContext()

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-md space-y-6">
        <a href="/" className="inline-flex font-display text-sm font-semibold tracking-tight text-foreground no-underline">
          {BRAND.name}
        </a>
        <CardHeader className="p-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-brand-bright">Account</p>
          <CardDescription className="mt-3 text-pretty font-sans text-sm leading-6 text-muted-foreground">
            Sign in with a one-time code sent to your email.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <AuthForm authUrl={authUrl} googleEnabled={googleEnabled} />
        </CardContent>
      </div>
    </main>
  )
}