import { PAST_DUE_GRACE_DAYS, PAST_DUE_REMINDER_DAYS } from '@vc/config'
import { createDataAccess } from '@vc/db'
import { sendPaymentFailedEmail } from '@/server/email'

const DAY_MS = 24 * 60 * 60 * 1000
const GRACE_MS = PAST_DUE_GRACE_DAYS * DAY_MS
/**
 * Emails per run. The run shares the 15-minute invocation's 1,000 D1 queries
 * with the claim sweep, media recovery and analytics (see SWEEP_QUERY_BUDGET),
 * so it stays at 1 + this many (the list, then one claim each); 40 an hour is
 * far above the failed renewals a day.
 */
export const PAYMENT_REMINDERS_PER_RUN = 10

/**
 * The failed-payment emails (15-minute cron): one email on each of days 1, 3
 * and 6 of a past-due episode's grace, to the workspace owner. Only episodes
 * whose latest due email is unclaimed are read, so a missed run sends just the
 * latest one and claimed emails never take a slot. A blog AutoSEOPilot
 * sponsors keeps its paid features, so it is never told they will pause.
 *
 * Delivery is at most once. Each email is claimed for its episode and day
 * right before the send, and the claim holds only while, on the clock at that
 * moment, the episode is still past due, inside its grace and unsponsored, the
 * day is still the latest one due, the owner still has that address, and no
 * later email was claimed. So a repeated sweep, an overlapping run or a
 * replayed webhook never sends it twice, and a payment that goes through stops
 * every email not yet handed off. A claim is never given back: Cloudflare's
 * send_email has no idempotency key and its errors do not tell a rejection
 * from an unknown outcome, so a retry could email the owner twice, and a
 * recipient that keeps rejecting would hold a slot every run. A failed send is
 * logged and the next due day's email covers it; the dashboard's past-due
 * banner shows the same deadline meanwhile.
 */
export async function runPaymentReminders(
  workerEnv: Cloudflare.Env,
  nowMs = Date.now(),
  send: typeof sendPaymentFailedEmail = sendPaymentFailedEmail,
): Promise<{ sent: number }> {
  if (String(workerEnv.SELF_HOSTED) === 'true') return { sent: 0 }
  const startedAt = Date.now()
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
    const { workspaceId, pastDueSince, day, ownerEmail } = reminder
    const claimed = await billing.claimPaymentReminder({
      workspaceId,
      pastDueSince,
      day,
      ownerEmail,
      nowMs: nowMs + (Date.now() - startedAt),
      graceMs: GRACE_MS,
      days: PAST_DUE_REMINDER_DAYS,
    })
    if (!claimed) continue
    try {
      await send({
        to: ownerEmail,
        siteName: reminder.siteName ?? 'your blog',
        day: day as (typeof PAST_DUE_REMINDER_DAYS)[number],
        graceEndsAt: pastDueSince + GRACE_MS,
        billingUrl: reminder.siteId
          ? `${appUrl}/dashboard/billing?site=${encodeURIComponent(reminder.siteId)}`
          : `${appUrl}/dashboard/billing`,
      })
      sent += 1
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'payment_reminder_failed', workspaceId, day, error: String(error) }))
    }
  }
  return { sent }
}
