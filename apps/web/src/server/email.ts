import { env } from 'cloudflare:workers'
import { createEmailClient } from '@opencoredev/email-sdk'
import { cloudflare } from '@opencoredev/email-sdk/cloudflare'

type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

const SUBJECTS: Record<OtpType, string> = {
  'sign-in': 'Your VibeCMS sign-in code',
  'email-verification': 'Verify your VibeCMS email',
  'forget-password': 'Your VibeCMS password reset code',
  'change-email': 'Confirm your new VibeCMS email',
}

const DEFAULT_FROM = 'VibeCMS <hey@vibecms.dev>'

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

/**
 * Delivers a one-time passcode.
 *
 * Same code path in every environment - the only split is delivery: when an
 * email provider is configured we send through the Email SDK (Cloudflare Email
 * Sending adapter); otherwise we log the code so the flow stays testable locally
 * without a provider. The code is also stored (plain) in the `verification`
 * table, which is how automated smoke reads it. EMAIL_FROM must be a sender on a
 * domain onboarded to Cloudflare Email Sending.
 */
export async function sendOtpEmail(email: string, otp: string, type: OtpType) {
  const subject = SUBJECTS[type] ?? SUBJECTS['sign-in']
  const client = emailClient()

  if (!client) {
    console.log(`[email-otp] to=${email} type=${type} otp=${otp}`)
    return
  }

  const html = `<p>Your VibeCMS code is <strong style="font-size:18px;letter-spacing:3px">${otp}</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`
  const text = `Your VibeCMS code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`

  try {
    await client.send({
      from: env.EMAIL_FROM ?? DEFAULT_FROM,
      to: email,
      subject,
      html,
      text,
    })
  } catch (error) {
    console.error(`[email-otp] cloudflare send failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
