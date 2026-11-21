import { PAST_DUE_GRACE_DAYS, PAST_DUE_REMINDER_DAYS } from '@vc/config'
import { createDataAccess } from '@vc/db'
import { resolveEffectiveEntitlementForWorkspace } from '@/server/effective-entitlement'
import { sendPaymentFailedEmail } from '@/server/email'

const DAY_MS = 24 * 60 * 60 * 1000
const GRACE_MS = PAST_DUE_GRACE_DAYS * DAY_MS
const EPISODES_PER_RUN = 50

/**
 * The failed-payment emails (15-minute cron): one email on each of days 1, 3
 * and 6 of a past-due episode's grace, to the workspace owner. A missed tick
 * sends only the latest due email. Each email is claimed for its episode
 * before it is sent, so a repeated sweep or a replayed webhook never sends it
 * twice; a payment that goes through ends the episode and the emails with it.
 * A blog AutoSEOPilot sponsors keeps its paid features, so it is never told
 * they will pause.
 */
export async function runPaymentReminders(workerEnv: Cloudflare.Env, nowMs = Date.now()): Promise<{ sent: number }> {
  if (String(workerEnv.SELF_HOSTED) === 'true') return { sent: 0 }
  const billing = createDataAccess(workerEnv.DB).billing
  let sent = 0
  for (const episode of await billing.listPastDueForReminders(nowMs, GRACE_MS, EPISODES_PER_RUN)) {
    const elapsedDays = (nowMs - episode.pastDueSince) / DAY_MS
    const day = [...PAST_DUE_REMINDER_DAYS].reverse().find((reminderDay) => elapsedDays >= reminderDay - 1)
    if (!day || episode.sentDays.some((sentDay) => sentDay >= day)) continue
    if (!episode.ownerEmail) {
      console.warn(JSON.stringify({ level: 'warn', event: 'payment_reminder_no_owner', workspaceId: episode.workspaceId }))
      continue
    }
    const entitlement = await resolveEffectiveEntitlementForWorkspace(episode.workspaceId, { now: nowMs / 1000 })
    if (entitlement.managedSponsorship.active) continue
    if (!(await billing.claimPaymentReminder(episode.workspaceId, episode.pastDueSince, day, Math.floor(nowMs / 1000)))) {
      continue
    }
    try {
      await sendPaymentFailedEmail({
        to: episode.ownerEmail,
        siteName: episode.siteName ?? 'your blog',
        day,
        graceEndsAt: episode.pastDueSince + GRACE_MS,
        billingUrl: `${workerEnv.APP_URL.replace(/\/$/, '')}/dashboard/billing`,
      })
      sent += 1
    } catch (error) {
      await billing.releasePaymentReminder(episode.workspaceId, episode.pastDueSince, day)
      console.error(
        JSON.stringify({ level: 'error', event: 'payment_reminder_failed', workspaceId: episode.workspaceId, day, error: String(error) }),
      )
    }
  }
  return { sent }
}
