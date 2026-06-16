import { env } from 'cloudflare:workers'

type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

const SUBJECTS: Record<OtpType, string> = {
  'sign-in': 'Your VibeCMS sign-in code',
  'email-verification': 'Verify your VibeCMS email',
  'forget-password': 'Your VibeCMS password reset code',
  'change-email': 'Confirm your new VibeCMS email',
}

/** Plunk wants `from` as a bare email or {name,email}; accept the "Name <email>" form too. */
function parseSender(value: string | undefined) {
  if (!value) return undefined
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return match ? { name: match[1] || undefined, email: match[2] } : value
}

/**
 * Delivers a one-time passcode.
 *
 * Same code path in every environment - the only split is delivery: with a
 * PLUNK_API_KEY set we email the code via Plunk (production), otherwise we log
 * it so the flow stays testable locally without an email provider. The code is
 * also stored (plain) in the `verification` table, which is how automated smoke
 * reads it. EMAIL_FROM must be a sender on a Plunk-verified domain.
 */
export async function sendOtpEmail(email: string, otp: string, type: OtpType) {
  const subject = SUBJECTS[type] ?? SUBJECTS['sign-in']

  if (!env.PLUNK_API_KEY) {
    console.log(`[email-otp] to=${email} type=${type} otp=${otp}`)
    return
  }

  const body = `<p>Your VibeCMS code is <strong style="font-size:18px;letter-spacing:3px">${otp}</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`

  const response = await fetch('https://next-api.useplunk.com/v1/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.PLUNK_API_KEY}`,
    },
    body: JSON.stringify({
      from: parseSender(env.EMAIL_FROM),
      to: email,
      subject,
      body,
    }),
  })

  if (!response.ok) {
    console.error(`[email-otp] plunk failed ${response.status}: ${await response.text()}`)
  }
}
