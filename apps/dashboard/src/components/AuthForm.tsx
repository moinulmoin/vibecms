import { setupAuthClient } from '~/lib/auth-client'
import { Button, Field, FieldLabel, Input, Alert } from '@vc/ui'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useEffect, useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { Spinner } from '~/components/ui/spinner'

type Step = 'email' | 'otp'
type SocialProvider = 'google' | 'github'
/** "start": arrived from a "Start free" link; otherwise a plain sign-in. Same flow either way. */
export type AuthIntent = 'start'

function ProviderLogo({ provider }: { provider: SocialProvider }) {
  if (provider === 'github') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="currentColor">
        <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  )
}

const SOCIAL_LABELS: Record<SocialProvider, string> = {
  google: 'Google',
  github: 'GitHub',
}

const RESEND_COOLDOWN_SECONDS = 30

export function retryMessage(error: unknown): string {
  const value = error as { retryAfter?: unknown; data?: { retryAfter?: unknown }; response?: Response }
  const seconds = Number(value.retryAfter ?? value.data?.retryAfter ?? value.response?.headers.get('retry-after'))
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Too many codes requested. Try again after the server’s rate limit resets.'
  const minutes = Math.ceil(seconds / 60)
  return `Too many codes requested. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
}

export function AuthForm({ googleEnabled, githubEnabled, intent }: { googleEnabled: boolean; githubEnabled: boolean; intent?: AuthIntent }) {
  const authClient = setupAuthClient()
  const providers: SocialProvider[] = []
  if (googleEnabled) providers.push('google')
  if (githubEnabled) providers.push('github')
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function sendCode(isResend = false) {
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
      if (sendError) {
        setError(
          (sendError as { status?: number }).status === 429
            ? retryMessage(sendError)
            : (sendError.message ?? 'We couldn’t send a code. Check the address and try again.'),
        )
        return
      }
      setStep('otp')
      setOtp('')
      setCooldown(RESEND_COOLDOWN_SECONDS)
      if (isResend) setNotice('New code sent.')
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function verifyCode(code = otp) {
    if (code.length < 6) return
    setError(null)
    setNotice(null)
    setLoading(true)
    void authClient.signIn
      .emailOtp(
        { email, otp: code },
        {
          onSuccess: async () => {
            try {
              const response = await fetch('/api/onboarding/ensure', { method: 'POST' })
              if (!response.ok) throw new Error('ensure failed')
              window.location.href = '/dashboard'
            } catch {
              setError('You’re signed in, but your blog didn’t open. Try again.')
              setLoading(false)
            }
          },
          onError: () => {
            setError('That code didn’t work. Check it, or send a new one.')
            setOtp('')
            setLoading(false)
          },
        },
      )
      .catch(() => {
        setError('Could not verify the code. Check your connection and try again.')
        setLoading(false)
      })
  }

  async function continueWithProvider(provider: SocialProvider) {
    setError(null)
    setLoading(true)
    try {
      const { error: socialError } = await authClient.signIn.social({ provider, callbackURL: '/dashboard' })
      if (socialError) {
        setError(socialError.message ?? `Could not start ${SOCIAL_LABELS[provider]} sign-in.`)
        setLoading(false)
      }
    } catch {
      setError(`Could not reach ${SOCIAL_LABELS[provider]} sign-in. Check your connection and try again.`)
      setLoading(false)
    }
  }

  if (step === 'otp') {
    return (
      <div className="grid gap-6">
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground">Check your email</h1>
          <p className="text-pretty text-[0.9375rem] leading-6 text-muted-foreground">
            We sent a 6-digit code to <span className="inline-block max-w-full break-all font-medium text-foreground">{email}</span>.{' '}
            <button
              type="button"
              className="text-foreground underline underline-offset-4 hover:text-primary"
              onClick={() => {
                setStep('email')
                setOtp('')
                setError(null)
                setNotice(null)
              }}
            >
              Change
            </button>
          </p>
        </header>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            verifyCode()
          }}
        >
          {error ? (
            <Alert variant="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="otp" className="sr-only">
              6-digit code
            </FieldLabel>
            <InputOTP
              id="otp"
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(value) => {
                setOtp(value)
                if (error) setError(null)
              }}
              onComplete={(value: string) => {
                if (!loading) verifyCode(value)
              }}
              autoFocus
              disabled={loading}
              aria-invalid={error ? true : undefined}
            >
              <InputOTPGroup className="w-full gap-2">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    aria-invalid={error ? true : undefined}
                    className="h-14 flex-1 rounded-lg border font-mono text-xl first:rounded-lg last:rounded-lg"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </Field>
          <Button className="h-11 w-full" type="submit" disabled={loading || otp.length < 6} aria-busy={loading || undefined}>
            {loading ? (
              <>
                <Spinner aria-hidden="true" />
                Checking…
              </>
            ) : (
              'Continue'
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            {notice ? `${notice} ` : 'Didn’t get it? Check spam, or '}
            {cooldown > 0 ? (
              <span className="tabular-nums">resend in {cooldown}s</span>
            ) : (
              <button
                type="button"
                className="text-foreground underline underline-offset-4 hover:text-primary disabled:opacity-50"
                disabled={loading}
                onClick={() => void sendCode(true)}
              >
                send a new code
              </button>
            )}
            .
          </p>
        </form>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <header className="space-y-2">
        <h1 className="text-balance font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground">
          {intent === 'start' ? 'Start your blog' : 'Sign in to vibecms'}
        </h1>
        <p className="text-pretty text-[0.9375rem] leading-6 text-muted-foreground">
          {intent === 'start'
            ? 'Free to try, no card. Enter your email and we’ll send you a code.'
            : 'New here? The same step creates your blog. We’ll email you a code.'}
        </p>
      </header>

      {error ? (
        <Alert variant="error" role="alert">
          {error}
        </Alert>
      ) : null}

      {providers.length > 0 ? (
        <div className="grid gap-3">
          {providers.map((provider) => (
            <Button
              key={provider}
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={loading}
              onClick={() => void continueWithProvider(provider)}
            >
              <ProviderLogo provider={provider} />
              Continue with {SOCIAL_LABELS[provider]}
            </Button>
          ))}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            or
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
        </div>
      ) : null}

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void sendCode()
        }}
      >
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            spellCheck={false}
            placeholder="you@example.com"
            required
            autoFocus
            className="h-11"
          />
        </Field>
        <Button className="h-11 w-full" type="submit" disabled={loading} aria-busy={loading || undefined}>
          {loading ? (
            <>
              <Spinner aria-hidden="true" />
              Sending code…
            </>
          ) : (
            'Email me a code'
          )}
        </Button>
      </form>
    </div>
  )
}
