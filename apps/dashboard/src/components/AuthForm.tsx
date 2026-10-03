import { setupAuthClient } from '~/lib/auth-client'
import { Button, Field, FieldLabel, Input, Alert } from '@vc/ui'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useEffect, useState } from 'react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { Spinner } from '~/components/ui/spinner'

type Step = 'email' | 'otp'
type SocialProvider = 'google' | 'github'

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

export function AuthForm({ googleEnabled, githubEnabled }: { googleEnabled: boolean; githubEnabled: boolean }) {
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
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">Check your email</h1>
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
        <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">Sign in to vibecms</h1>
        <p className="text-pretty text-[0.9375rem] leading-6 text-muted-foreground">
          New or returning, it’s the same: we’ll email you a code.
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
