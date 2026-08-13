import { setupAuthClient } from '~/lib/auth-client'
import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Alert } from '@vc/ui'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { Spinner } from '~/components/ui/spinner'

type Step = 'email' | 'otp'

export function AuthForm({ googleEnabled }: { googleEnabled: boolean }) {
  const authClient = setupAuthClient()
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
    try {
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
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
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function verifyCode() {
    setError(null)
    setLoading(true)
    void authClient.signIn.emailOtp(
      { email, otp },
      {
        onSuccess: async () => {
          try {
            const response = await ensureOnboardingRoute()
            if (!response.ok) throw new Error('Onboarding initialization failed')
            window.location.href = '/dashboard'
          } catch {
            setError('You are signed in, but we could not open your workspace. Try again.')
            setLoading(false)
          }
        },
        onError: (ctx: { error: { message?: string } }) => {
          setError(ctx.error.message ?? 'That code did not work. Resend a fresh one and try again.')
          setLoading(false)
        },
      },
    ).catch(() => {
      setError('Could not verify the code. Check your connection and try again.')
      setLoading(false)
    })
  }

  async function continueWithGoogle() {
    setError(null)
    setLoading(true)
    try {
      const { error: socialError } = await authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' })
      if (socialError) {
        setError(socialError.message ?? 'Could not start Google sign-in.')
        setLoading(false)
      }
    } catch {
      setError('Could not reach Google sign-in. Check your connection and try again.')
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
          <div className="my-6 flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
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
                className="font-mono text-[11px] font-medium text-muted-foreground"
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
                    <Spinner aria-hidden="true" />
                    Sending code…
                  </>
                ) : (
                  'Send sign-in code'
                )}
              </Button>
            </Field>
            <FieldDescription className="text-center">
              New here? Entering your email creates your account.
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
                className="font-mono text-[11px] font-medium text-muted-foreground"
              >
                6-digit code
              </FieldLabel>
              <InputOTP
                id="otp"
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                value={otp}
                onChange={setOtp}
                onComplete={() => {
                  if (!loading) verifyCode()
                }}
                autoFocus
                disabled={loading}
              >
                <InputOTPGroup className="w-full">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className="h-12 flex-1 font-mono text-base first:rounded-l-xl last:rounded-r-xl"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
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
                    <Spinner aria-hidden="true" />
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
                className="h-auto justify-start px-0 font-mono text-xs font-semibold text-primary underline"
                disabled={loading}
                onClick={() => void sendCode()}
              >
                Resend code
              </Button>
              <Button
                type="button"
                variant="link"
                className="h-auto justify-start px-0 font-mono text-xs font-semibold text-primary underline"
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