import { setupAuthClient } from '~/lib/auth-client'
import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Alert } from '@vc/ui'
import { ReloadIcon } from '@radix-ui/react-icons'
import { useState } from 'react'

type Step = 'email' | 'otp'

export function AuthForm({ authUrl, googleEnabled }: { authUrl: string; googleEnabled: boolean }) {
  const authClient = setupAuthClient(authUrl)
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function ensureOnboardingRoute() {
    return fetch('/api/onboarding/ensure', { method: 'POST' })
  }

  async function sendCode() {
    setError(null)
    setInfo(null)
    setLoading(true)
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
    setLoading(false)
    if (sendError) {
      const message =
        (sendError as { status?: number }).status === 429
          ? 'Too many codes requested for this email. Please wait a bit and try again.'
          : (sendError.message ?? 'Could not send a code. Check the address and try again.')
      setError(message)
      return
    }
    setStep('otp')
    setInfo(`We sent a 6-digit code to ${email}.`)
  }

  function verifyCode() {
    setError(null)
    setLoading(true)
    void authClient.signIn.emailOtp(
      { email, otp },
      {
        onSuccess: async () => {
          await ensureOnboardingRoute()
          window.location.href = '/'
        },
        onError: (ctx: { error: { message?: string } }) => {
          setError(ctx.error.message ?? 'That code did not work. Resend a fresh one and try again.')
          setLoading(false)
        },
      },
    )
  }

  async function continueWithGoogle() {
    setError(null)
    setLoading(true)
    const { error: socialError } = await authClient.signIn.social({ provider: 'google', callbackURL: '/' })
    if (socialError) {
      setError(socialError.message ?? 'Could not start Google sign-in.')
      setLoading(false)
    }
  }

  return (
    <div className="mt-8 font-sans">
      {error ? (
        <Alert variant="error" className="mb-4">
          {error}
        </Alert>
      ) : info ? (
        <Alert variant="success" className="mb-4">
          {info}
        </Alert>
      ) : null}

      {googleEnabled ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-xl"
            disabled={loading}
            onClick={() => void continueWithGoogle()}
          >
            Continue with Google
          </Button>
          <div className="my-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            or
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
        </>
      ) : null}

      {step === 'email' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void sendCode()
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel
                htmlFor="email"
                className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Email
              </FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                spellCheck={false}
                required
                autoFocus
              />
            </Field>
            <Field>
              <Button className="h-11 w-full rounded-xl" type="submit" disabled={loading} aria-busy={loading || undefined}>
                {loading ? (
                  <>
                    <ReloadIcon className="size-4 animate-spin" aria-hidden="true" />
                    Sending code…
                  </>
                ) : (
                  'Send sign-in code'
                )}
              </Button>
            </Field>
            <FieldDescription className="text-center">
              No password needed. New here? Entering your email creates your account.
            </FieldDescription>
          </FieldGroup>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            verifyCode()
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel
                htmlFor="otp"
                className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                6-digit code
              </FieldLabel>
              <Input
                id="otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                required
                autoFocus
              />
            </Field>
            <Field>
              <Button
                className="h-11 w-full rounded-xl"
                type="submit"
                disabled={loading || otp.length < 6}
                aria-busy={loading || undefined}
              >
                {loading ? (
                  <>
                    <ReloadIcon className="size-4 animate-spin" aria-hidden="true" />
                    Verifying…
                  </>
                ) : (
                  'Verify and continue'
                )}
              </Button>
            </Field>
            <Field className="gap-1 text-left sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="link"
                className="h-auto justify-start px-0 font-mono text-xs font-semibold text-brand-bright underline"
                disabled={loading}
                onClick={() => void sendCode()}
              >
                Resend code
              </Button>
              <Button
                type="button"
                variant="link"
                className="h-auto justify-start px-0 font-mono text-xs font-semibold text-brand-bright underline"
                disabled={loading}
                onClick={() => {
                  setStep('email')
                  setOtp('')
                  setError(null)
                  setInfo(null)
                }}
              >
                Use a different email
              </Button>
            </Field>
          </FieldGroup>
        </form>
      )}
    </div>
  )
}