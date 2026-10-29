import { env } from 'cloudflare:workers'
import { SUPPORT_EMAIL } from '@vc/config'

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

/**
 * "Keep your blog" reminder for the owner of a paused AutoSEOPilot-managed
 * blog (days 7/14/21/28 after the revoke). Same delivery rules as the OTP
 * mail: the EMAIL binding is authoritative, non-prod logs instead of failing.
 */
export async function sendClaimReminderEmail(input: {
  to: string
  siteName: string
  daysLeft: number
  /** Epoch seconds. */
  deadline: number
  loginUrl: string
}) {
  const isProd = env.APP_ENV === 'production'
  const deadlineText = new Date(input.deadline * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const subject =
    input.daysLeft <= 2
      ? `Your blog "${input.siteName}" will be deleted in ${input.daysLeft} day${input.daysLeft === 1 ? '' : 's'}`
      : `Your blog "${input.siteName}" is paused — ${input.daysLeft} days left to keep it`
  const line = `Your AutoSEOPilot plan ended, so this blog is paused. To keep the same blog, posts, media and domain, sign in to VibeCMS with ${input.to} and choose vibecms Cloud before ${deadlineText}.`
  const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;"><p style="font-size:15px;line-height:1.6;">${line}</p><p style="margin:24px 0;"><a href="${input.loginUrl}" style="display:inline-block;padding:12px 24px;background:#111827;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Sign in to VibeCMS</a></p><p style="font-size:12px;color:#6b7280;">You are receiving this because this VibeCMS blog was included with your AutoSEOPilot plan.</p></body></html>`
  const text = `${line}\n\nSign in: ${input.loginUrl}`

  if (!env.EMAIL) {
    if (isProd && String(env.SELF_HOSTED) !== 'true') {
      throw new Error('email not configured: add a send_email binding named EMAIL and onboard the sending domain')
    }
    console.log(`[claim-reminder] to=${input.to} site=${input.siteName} daysLeft=${input.daysLeft} deadline=${deadlineText}`)
    return
  }
  if (!isProd) console.log(`[claim-reminder] to=${input.to} site=${input.siteName} daysLeft=${input.daysLeft}`)
  try {
    await env.EMAIL.send({
      to: input.to,
      from: parseFromAddress(env.EMAIL_FROM ?? DEFAULT_FROM),
      subject,
      html,
      text,
    })
  } catch (err) {
    if (!isProd) {
      console.warn(`[claim-reminder] send failed in non-prod (ok locally): ${String(err)}`)
      return
    }
    throw err
  }
}

/**
 * An operational alert to the support address, because a log line only
 * reaches someone who goes looking. Production without the EMAIL binding is a
 * misconfiguration and throws, so the caller keeps the notice owed; elsewhere
 * the notice is logged.
 */
async function sendSupportNotice(notice: {
  tag: string
  subject: string
  lead: string
  facts: [string, string][]
  logLine: string
}) {
  const isProd = env.APP_ENV === 'production'
  const html = `<!DOCTYPE html><html lang="en"><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;"><p style="font-size:15px;line-height:1.6;">${notice.lead}</p><table style="font-size:14px;line-height:1.6;border-collapse:collapse;margin:16px 0;">${notice.facts
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 16px 2px 0;color:#6b7280;">${label}</td><td style="padding:2px 0;">${value}</td></tr>`,
    )
    .join('')}</table></body></html>`
  const text = `${notice.lead}\n\n${notice.facts.map(([label, value]) => `${label}: ${value}`).join('\n')}`

  if (!env.EMAIL) {
    if (isProd && String(env.SELF_HOSTED) !== 'true') {
      throw new Error('email not configured: add a send_email binding named EMAIL and onboard the sending domain')
    }
    console.log(`[${notice.tag}] ${notice.logLine}`)
    return
  }
  if (!isProd) {
    console.log(`[${notice.tag}] ${notice.logLine}`)
  }
  try {
    await env.EMAIL.send({
      to: SUPPORT_EMAIL,
      from: parseFromAddress(env.EMAIL_FROM ?? DEFAULT_FROM),
      subject: notice.subject,
      html,
      text,
    })
  } catch (err) {
    if (!isProd) {
      console.warn(`[${notice.tag}] send failed in non-prod (ok locally): ${String(err)}`)
      return
    }
    throw err
  }
}

/**
 * Operational alert: a paid claim arrived for a blog that is being deleted,
 * or that has already been deleted. The customer may have paid for a blog
 * that no longer exists, so the money has to be refunded by hand at Polar.
 */
export async function sendPurgeConflictEmail(input: {
  workspaceId: string
  siteId: string | null
  polarCustomerId: string | null
  polarSubscriptionId: string | null
  polarOrderId: string | null
  polarCheckoutId: string | null
  eventType: string | null
  eventId: string | null
}) {
  await sendSupportNotice({
    tag: 'purge-conflict',
    subject: `Refund needed: a paid claim arrived for a deleted blog (${input.workspaceId})`,
    lead:
      'A paid claim arrived for a blog that is being deleted, or that has already been deleted. The subscription was not applied, so nobody was charged for a blog they do not have. Refund it by hand at Polar.',
    facts: [
      ['Workspace', input.workspaceId],
      ['Site', input.siteId ?? 'unknown'],
      ['Polar customer', input.polarCustomerId ?? 'unknown'],
      ['Polar subscription', input.polarSubscriptionId ?? 'unknown'],
      ['Polar order', input.polarOrderId ?? 'unknown'],
      ['Polar checkout', input.polarCheckoutId ?? 'unknown'],
      ['Event', `${input.eventType ?? 'unknown'}${input.eventId ? ` (${input.eventId})` : ''}`],
    ],
    logLine: `to=${SUPPORT_EMAIL} workspace=${input.workspaceId} subscription=${input.polarSubscriptionId}`,
  })
}

/**
 * Operational alert: a blog that already had a live vibecms subscription was
 * paid for again from a second checkout (for example monthly and yearly in
 * two tabs). The second subscription was not applied, so the customer pays
 * twice until it is refunded and revoked by hand at Polar.
 */
export async function sendDuplicateSubscriptionEmail(input: {
  workspaceId: string
  keptSubscriptionId: string
  duplicateSubscriptionId: string
  polarCustomerId: string | null
  polarCheckoutId: string | null
  eventType: string
  eventId: string
}) {
  await sendSupportNotice({
    tag: 'duplicate-subscription',
    subject: `Refund needed: a blog was paid for twice (${input.workspaceId})`,
    lead:
      'A blog that already had a live vibecms subscription was paid for again from a second checkout. The second subscription was not applied: the blog stays on the kept subscription. Refund the second subscription and revoke it by hand at Polar.',
    facts: [
      ['Workspace', input.workspaceId],
      ['Kept subscription', input.keptSubscriptionId],
      ['Second subscription (refund and revoke)', input.duplicateSubscriptionId],
      ['Polar customer', input.polarCustomerId ?? 'unknown'],
      ['Polar checkout', input.polarCheckoutId ?? 'unknown'],
      ['Event', `${input.eventType} (${input.eventId})`],
    ],
    logLine: `to=${SUPPORT_EMAIL} workspace=${input.workspaceId} kept=${input.keptSubscriptionId} duplicate=${input.duplicateSubscriptionId}`,
  })
}
