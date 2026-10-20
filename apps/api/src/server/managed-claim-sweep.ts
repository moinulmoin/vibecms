/**
 * Daily "keep your blog" sweep for AutoSEOPilot-managed sites (claim window).
 *
 * Day 0 is the VibeCMS revoke (`revoked_at`): days 0-7 the blog serves
 * normally everywhere, day 7 it pauses on every ingress and the first
 * reminder goes out, and at day 30 unclaimed blogs are deleted — custom
 * hostnames, R2 objects, and every D1 row including (when the login belongs
 * to no other workspace) the user row. Runs on the existing daily cron; no
 * per-request timers. Every step is idempotent: the reminder markers and the
 * purge's guarded batch re-check state, so a claim or a resumed plan landing
 * mid-sweep deletes and sends nothing.
 */
import { MANAGED_CLAIM_REMINDERS, MANAGED_CLAIM_WINDOW } from '@vc/config'
import { createDataAccess, type ManagedClaimReminderDay, type ManagedClaimSweepCandidate } from '@vc/db'
import { deleteCustomHostname } from '@/server/custom-hostnames'
import { sendClaimReminderEmail } from '@/server/email'

const DAY_SECONDS = 24 * 60 * 60

function reminderMarker(candidate: ManagedClaimSweepCandidate, day: number): number | null {
  switch (day) {
    case 7:
      return candidate.claimDay7SentAt
    case 14:
      return candidate.claimDay14SentAt
    case 21:
      return candidate.claimDay21SentAt
    case 28:
      return candidate.claimDay28SentAt
    default:
      return null
  }
}

/**
 * The most recent reminder slot that is due. A missed cron tick sends the
 * latest one only: stacking days 7, 14, 21 and 28 into one run would mail the
 * owner four times at once, and an early slot's copy ("23 days left") would be
 * wrong by the time it lands.
 */
function latestDueReminder(elapsed: number): (typeof MANAGED_CLAIM_REMINDERS)[number] | null {
  let due: (typeof MANAGED_CLAIM_REMINDERS)[number] | null = null
  for (const reminder of MANAGED_CLAIM_REMINDERS) {
    if (elapsed < reminder.day * DAY_SECONDS) break
    due = reminder
  }
  return due
}

/** Best-effort R2 purge of a site's media prefix (`${siteId}/…`). */
async function purgeSiteR2Objects(bucket: R2Bucket, siteId: string): Promise<void> {
  const prefix = `${siteId}/`
  for (;;) {
    const listing = await bucket.list({ prefix, limit: 1000 })
    if (listing.objects.length === 0) break
    await bucket.delete(listing.objects.map((object) => object.key))
    if (!listing.truncated) break
  }
}

async function purgeClaimSite(
  env: Cloudflare.Env,
  candidate: ManagedClaimSweepCandidate,
  now: number,
): Promise<boolean> {
  // External resources first: if the DB batch below fails, the rows survive
  // and the next run re-attempts the (idempotent) hostname/R2 cleanup.
  const domains = await env.DB
    .prepare(
      `SELECT cloudflare_custom_hostname_id
       FROM domains
       WHERE site_id = ? AND cloudflare_custom_hostname_id IS NOT NULL`,
    )
    .bind(candidate.siteId)
    .all<{ cloudflare_custom_hostname_id: string }>()
  for (const row of domains.results ?? []) {
    // Fail-open by contract: a stale CF hostname does not block the purge.
    await deleteCustomHostname(row.cloudflare_custom_hostname_id)
  }
  await purgeSiteR2Objects(env.ASSETS_BUCKET, candidate.siteId)

  const purged = await createDataAccess(env.DB).managedSites.purgeRevokedManagedSite({
    externalWorkspaceId: candidate.externalWorkspaceId,
    workspaceId: candidate.workspaceId,
    siteId: candidate.siteId,
    ownerUserId: candidate.ownerUserId,
    deadline: candidate.revokedAt + MANAGED_CLAIM_WINDOW.windowSeconds,
  })
  if (!purged) {
    // State changed inside the batch (claim or resume raced us): keep everything.
    console.warn('[managed-claim-sweep] purge skipped, state changed mid-flight', {
      workspaceId: candidate.workspaceId,
      siteId: candidate.siteId,
      at: now,
    })
    return false
  }
  // The audit trail: activity rows cascade away with the site, so this line
  // is the operational record that a blog was deleted.
  console.log('[managed-claim-sweep] purged unclaimed managed blog', {
    workspaceId: candidate.workspaceId,
    siteId: candidate.siteId,
    externalWorkspaceId: candidate.externalWorkspaceId,
    ownerUserId: candidate.ownerUserId,
    revokedAt: candidate.revokedAt,
    at: now,
  })
  return true
}

export interface ManagedClaimSweepResult {
  skipped: boolean
  candidates: number
  remindersSent: number
  purged: number
}

/** The daily cron entry: reminders at days 7/14/21/28, purge at day 30. */
export async function runManagedClaimSweep(workerEnv: Cloudflare.Env): Promise<ManagedClaimSweepResult> {
  if (String(workerEnv.SELF_HOSTED) === 'true') {
    return { skipped: true, candidates: 0, remindersSent: 0, purged: 0 }
  }
  const now = Math.floor(Date.now() / 1000)
  const repo = createDataAccess(workerEnv.DB).managedSites
  const candidates = await repo.listClaimSweepCandidates()
  let remindersSent = 0
  let purged = 0

  for (const candidate of candidates) {
    const elapsed = now - candidate.revokedAt
    const deadline = candidate.revokedAt + MANAGED_CLAIM_WINDOW.windowSeconds
    try {
      if (elapsed >= MANAGED_CLAIM_WINDOW.windowSeconds) {
        // Past the deadline the blog is deleted, not reminded about.
        if (await purgeClaimSite(workerEnv, candidate, now)) purged += 1
        continue
      }
      const reminder = latestDueReminder(elapsed)
      if (!reminder || reminderMarker(candidate, reminder.day) !== null) continue
      // Claim the marker first: at most one reminder per day-slot ever,
      // even with overlapping cron runs.
      const claimed = await repo.markClaimReminderSent(
        candidate.externalWorkspaceId,
        reminder.day as ManagedClaimReminderDay,
        now,
      )
      if (!claimed) continue
      try {
        await sendClaimReminderEmail({
          to: candidate.ownerEmail,
          siteName: candidate.siteName,
          daysLeft: Math.max(1, Math.ceil((deadline - now) / DAY_SECONDS)),
          deadline,
          loginUrl: `${workerEnv.APP_URL.replace(/\/$/, '')}/login`,
        })
        remindersSent += 1
      } catch (error) {
        // A definite failure releases the slot so tomorrow's run retries.
        await repo.clearClaimReminderSent(
          candidate.externalWorkspaceId,
          reminder.day as ManagedClaimReminderDay,
          now,
        )
        console.warn('[managed-claim-sweep] reminder send failed', {
          workspaceId: candidate.workspaceId,
          day: reminder.day,
          error: String(error),
        })
      }
    } catch (error) {
      // Per-site isolation: one broken site never blocks the rest.
      console.warn('[managed-claim-sweep] site sweep failed', {
        workspaceId: candidate.workspaceId,
        error: String(error),
      })
    }
  }
  return { skipped: false, candidates: candidates.length, remindersSent, purged }
}
