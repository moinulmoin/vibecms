import { env } from 'cloudflare:workers'
import { createEmailClient } from '@opencoredev/email-sdk'
import { cloudflare } from '@opencoredev/email-sdk/cloudflare'

type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

const SUBJECTS: Record<OtpType, string> = {
  'sign-in': 'Your vibecms sign-in code',
  'email-verification': 'Verify your vibecms email',
  'forget-password': 'Your vibecms password reset code',
  'change-email': 'Confirm your new vibecms email',
}

const DEFAULT_FROM = 'vibecms <hey@vibecms.dev>'

/**
 * Lazily build the Email SDK client.
 *
 * We go through the SDK's adapter model on purpose: the provider can be swapped
 * (Cloudflare Email Sending today; Resend/Postmark/etc. later, plus fallback
 * routes) without touching any call site. Returns null when sending is not
 * configured, so dev and tests fall back to logging the code.
 *
 * Built per call because `env` (cloudflare:workers) is only readable at request
 * time, not at module init.
 */
function emailClient() {
  const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  if (!apiToken || !accountId) return null
  return createEmailClient({
    adapters: [cloudflare({ apiToken, accountId })],
  })
}

// Delivers a one-time passcode. Hosted prod sends via the Email SDK (Cloudflare
// Email Sending adapter) and treats a missing provider or an unaccepted message as
// a hard error; dev/self-host log the code (also stored plain in `verification`).
export async function sendOtpEmail(email: string, otp: string, type: OtpType) {
  const subject = SUBJECTS[type] ?? SUBJECTS['sign-in']
  const client = emailClient()

  if (!client) {
    if (env.APP_ENV === 'production') {
      throw new Error('email provider not configured: set CLOUDFLARE_EMAIL_API_TOKEN')
    }
    console.log(`[email-otp] to=${email} type=${type} otp=${otp}`)
    return
  }

  const html = `<p>Your vibecms code is <strong style="font-size:18px;letter-spacing:3px">${otp}</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`
  const text = `Your vibecms code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`

  const response = await client.send({
    from: env.EMAIL_FROM ?? DEFAULT_FROM,
    to: email,
    subject,
    html,
    text,
  })

  const accepted = response.accepted?.length ?? 0
  const rejected = response.rejected?.length ?? 0
  if (accepted === 0 || rejected > 0) {
    console.error(`[email-otp] provider=${response.provider} not accepted (accepted=${accepted} rejected=${rejected})`)
    throw new Error('email provider did not accept the message')
  }
}
