'use client'

import { useState } from 'react'
import { Button, Field, FieldDescription, FieldLabel, Input } from '@vc/ui'
import { SUBSCRIBE_CONSENT_TEXT } from '~/lib/subscribe-consent'
import styles from './subscribe-form.module.css'

type Status = 'idle' | 'submitting' | 'success' | 'error_invalid_email' | 'error_rate_limited' | 'error_generic'

interface Props {
  siteSlug: string
  placement: 'end' | 'footer'
}

export function SubscribeForm({ siteSlug, placement }: Props) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  const formClass =
    placement === 'end'
      ? `${styles.form} ${styles.formEnd}`
      : `${styles.form} ${styles.formFooter}`

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'submitting') return

    const form = e.currentTarget
    const company = (form.elements.namedItem('company') as HTMLInputElement | null)?.value ?? ''

    setStatus('submitting')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), siteSlug, company }),
      })

      if (res.ok) {
        setStatus('success')
        setEmail('')
        return
      }

      if (res.status === 400) {
        setStatus('error_invalid_email')
        return
      }

      if (res.status === 429) {
        setStatus('error_rate_limited')
        return
      }

      setStatus('error_generic')
    } catch {
      setStatus('error_generic')
    }
  }

  if (status === 'success') {
    return (
      <div className={formClass} aria-live="polite">
        <p className={styles.successMsg}>
          Thanks - you are on the early list. We will email you when delivery launches.
        </p>
      </div>
    )
  }

  return (
    <form className={formClass} onSubmit={handleSubmit} noValidate>
      <p className={styles.heading}>Get future posts when email delivery launches</p>
      <p className={styles.subtext}>
        Join the early list. No emails until delivery is live.
      </p>

      {/* Honeypot - hidden from real users, bots fill it */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor="sf-company">Company</label>
        <input
          id="sf-company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <Field>
        <FieldLabel htmlFor="sf-email">Email address</FieldLabel>
        <div className={styles.row}>
          <div className={styles.emailInput}>
            <Input
              id="sf-email"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              aria-invalid={status === 'error_invalid_email' ? true : undefined}
              disabled={status === 'submitting'}
            />
          </div>
          <Button
            type="submit"
            className={styles.submitBtn}
            disabled={status === 'submitting' || !email.trim()}
          >
            {status === 'submitting' ? 'Sending...' : 'Notify me'}
          </Button>
        </div>
        {status === 'error_invalid_email' && (
          <p className={styles.errorMsg} role="alert">
            Please enter a valid email address.
          </p>
        )}
        {status === 'error_rate_limited' && (
          <p className={styles.errorMsg} role="alert">
            Too many requests. Please try again later.
          </p>
        )}
        {status === 'error_generic' && (
          <p className={styles.errorMsg} role="alert">
            Something went wrong. Please try again.
          </p>
        )}
        <FieldDescription>
          <span className={styles.consentNote}>{SUBSCRIBE_CONSENT_TEXT}</span>
        </FieldDescription>
      </Field>
    </form>
  )
}
