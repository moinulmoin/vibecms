import { env } from 'cloudflare:workers'

type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

const SUBJECTS: Record<OtpType, string> = {
  'sign-in': 'Your vibecms sign-in code',
  'email-verification': 'Verify your vibecms email',
  'forget-password': 'Your vibecms password reset code',
  'change-email': 'Confirm your new vibecms email',
}

const DEFAULT_FROM = 'vibecms <hey@vibecms.dev>'

// Parse "Display Name <user@host>" → { email, name }; bare address → the address string.
// The send_email binding accepts `from` as either an EmailAddress ({ name, email }, name required) or a plain string.
function parseFromAddress(raw: string): { email: string; name: string } | string {
  const m = raw.match(/^\s*(?:(?<name>[^<]+?)\s*<)?(?<email>[^>\s]+)>?\s*$/)
  const email = m?.groups?.email ?? raw.trim()
  const name = m?.groups?.name?.trim()
  return name ? { email, name } : email
}

/**
 * Delivers a one-time passcode via the native Cloudflare `send_email` binding (named EMAIL).
 * No API token: sending identity is the Worker itself; the `from` domain must be onboarded
 * to Email Sending (`wrangler email sending enable <domain>`). When the binding is absent
 * (tests, unconfigured self-host, local dev) we fall back to logging the code; hosted prod
 * treats a missing binding as a hard error. In non-prod the code is also logged even when the
 * binding is present, so local miniflare (which cannot deliver without `remote: true`) and
 * dev QA still expose the OTP via `wrangler tail`.
 */
export async function sendOtpEmail(email: string, otp: string, type: OtpType) {
  const subject = SUBJECTS[type] ?? SUBJECTS['sign-in']
  const isProd = env.APP_ENV === 'production'

  if (!env.EMAIL) {
    if (isProd && String(env.SELF_HOSTED) !== 'true') {
      throw new Error('email not configured: add a send_email binding named EMAIL and onboard the sending domain')
    }
    console.log(`[email-otp] to=${email} type=${type} otp=${otp}`)
    return
  }

  if (!isProd) console.log(`[email-otp] to=${email} type=${type} otp=${otp}`)

  const html = `<p>Your vibecms code is <strong style="font-size:18px;letter-spacing:3px">${otp}</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`
  const text = `Your vibecms code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`

  try {
    await env.EMAIL.send({
      to: email,
      from: parseFromAddress(env.EMAIL_FROM ?? DEFAULT_FROM),
      subject,
      html,
      text,
    })
  } catch (err) {
    // Local miniflare cannot deliver without `remote: true`; never block auth there.
    if (!isProd) {
      console.warn(`[email-otp] send failed in non-prod (ok locally): ${String(err)}`)
      return
    }
    throw err
  }
}
