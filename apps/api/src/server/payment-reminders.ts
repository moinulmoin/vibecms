import { PAST_DUE_GRACE_DAYS, PAST_DUE_REMINDER_DAYS } from '@vc/config'
import { createDataAccess } from '@vc/db'
import { sendPaymentFailedEmail } from '@/server/email'

const DAY_MS = 24 * 60 * 60 * 1000
const GRACE_MS = PAST_DUE_GRACE_DAYS * DAY_MS
/**
 * Emails per run. The run shares the 15-minute invocation's 1,000 D1 queries
 * with the claim sweep, media recovery and analytics (see SWEEP_QUERY_BUDGET),
 * so it stays at 1 + 2 × this many (the list, then a claim and at most one
 * release each); 40 an hour is far above the failed renewals a day.
 */
export const PAYMENT_REMINDERS_PER_RUN = 10

/**
 * The failed-payment emails (15-minute cron): one email on each of days 1, 3
 * and 6 of a past-due episode's grace, to the workspace owner. Only episodes
 * whose latest due email is unsent are read, so a missed run sends just the
 * latest one and sent episodes never take a slot. A blog AutoSEOPilot
 * sponsors keeps its paid features, so it is never told they will pause.
 *
 * Delivery is at most once. Each email is claimed for its episode and day
 * right before the send, and the claim holds only while the episode is still
 * past due, inside its grace and unsponsored, with no later email claimed. So
 * a repeated sweep, an overlapping run or a replayed webhook never sends it
 * twice, and a payment that goes through stops every email not yet handed
 * off. A send that definitely failed gives the claim back for the next run;
 * a worker that dies between claim and send loses that one email, which the
 * next due day's email covers. Cloudflare's send_email has no idempotency key,
 * so retrying an unknown outcome could email the owner twice.
 */
export async function runPaymentReminders(workerEnv: Cloudflare.Env, nowMs = Date.now()): Promise<{ sent: number }> {
  if (String(workerEnv.SELF_HOSTED) === 'true') return { sent: 0 }
  const billing = createDataAccess(workerEnv.DB).billing
  const appUrl = workerEnv.APP_URL.replace(/\/$/, '')
  let sent = 0
  const due = await billing.listDuePaymentReminders({
    nowMs,
    graceMs: GRACE_MS,
    days: PAST_DUE_REMINDER_DAYS,
    limit: PAYMENT_REMINDERS_PER_RUN,
  })
  for (const reminder of due) {
    const { workspaceId, pastDueSince, day } = reminder
    if (!(await billing.claimPaymentReminder({ workspaceId, pastDueSince, day, nowMs, graceMs: GRACE_MS }))) continue
    try {
      await sendPaymentFailedEmail({
        to: reminder.ownerEmail,
        siteName: reminder.siteName ?? 'your blog',
        day: day as (typeof PAST_DUE_REMINDER_DAYS)[number],
        graceEndsAt: pastDueSince + GRACE_MS,
        billingUrl: reminder.siteId
          ? `${appUrl}/dashboard/billing?site=${encodeURIComponent(reminder.siteId)}`
          : `${appUrl}/dashboard/billing`,
      })
      sent += 1
    } catch (error) {
      await billing.releasePaymentReminder(workspaceId, pastDueSince, day)
      console.error(JSON.stringify({ level: 'error', event: 'payment_reminder_failed', workspaceId, day, error: String(error) }))
    }
  }
  return { sent }
}
