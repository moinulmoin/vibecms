/**
 * Daily "keep your blog" sweep for AutoSEOPilot-managed sites (claim window).
 *
 * Day 0 is the VibeCMS revoke (`revoked_at`): days 0-7 the blog serves
 * normally everywhere, day 7 it pauses on every ingress and the first
 * reminder goes out, and at day 30 an unclaimed blog is deleted — custom
 * hostnames, R2 objects, and every D1 row including (when the login belongs
 * to no other workspace) the user row. Runs on the existing daily cron; no
 * per-request timers.
 *
 * Deleting a blog is irreversible, so it happens in three steps:
 *
 * 1. ONE atomic write takes a durable purge intent. It only lands while the
 *    blog is still revoked, still past its own 30-day deadline, still never
 *    claimed and still the same lifecycle the candidate was selected at, and
 *    it records the resources the purge will delete (the Cloudflare custom
 *    hostname ids and the R2 prefixes). While the intent exists, claiming,
 *    plan resumption and re-provisioning are refused, so a resurrection can
 *    never race a running purge.
 * 2. The external cleanup runs from the recorded resources.
 * 3. The D1 rows go, guarded again inside one transaction.
 *
 * Every step is idempotent: a crash leaves the intent behind, and the next
 * run resumes the same cleanup from it instead of starting over.
 */
import { MANAGED_CLAIM_REMINDERS, MANAGED_CLAIM_WINDOW } from '@vc/config'
import {
  createDataAccess,
  type ManagedClaimReminderDay,
  type ManagedClaimSweepCandidate,
  type ManagedPurgeIntent,
} from '@vc/db'
import { deleteCustomHostname } from '@/server/custom-hostnames'
import { sendClaimReminderEmail } from '@/server/email'

const DAY_SECONDS = 24 * 60 * 60
/** Pages of candidates per run; the daily cron must stay well under its limit. */
const MAX_SWEEP_PAGES = 20
/** Intents resumed per run; a crashed purge must not starve the queue. */
const MAX_INTENT_PAGES = 20

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

/** The R2 prefixes a site's media lives under: its own folder and its OG cards. */
function siteR2Prefixes(siteId: string): string[] {
  return [`${siteId}/`, `og/${siteId}/`]
}

/** Best-effort R2 purge of the recorded prefixes (media and OG cards). */
async function purgeR2Prefixes(bucket: R2Bucket, prefixes: string[]): Promise<void> {
  for (const prefix of prefixes) {
    for (;;) {
      const listing = await bucket.list({ prefix, limit: 1000 })
      if (listing.objects.length === 0) break
      await bucket.delete(listing.objects.map((object) => object.key))
      if (!listing.truncated) break
    }
  }
}

/**
 * Runs the purge of one intent: the recorded external resources first, then
 * the D1 rows, then the intent itself. The intent is only finished once the
 * blog is really gone, so a crash in the middle leaves the work resumable. A
 * finished intent stays behind as the trace of a deleted blog.
 */
async function runPurgeIntent(
  env: Cloudflare.Env,
  intent: ManagedPurgeIntent,
  now: number,
): Promise<boolean> {
  for (const hostnameId of intent.hostnameIds) {
    // Fail-open by contract: a stale CF hostname does not block the purge.
    await deleteCustomHostname(hostnameId)
  }
  await purgeR2Prefixes(env.ASSETS_BUCKET, intent.r2Prefixes)

  const repo = createDataAccess(env.DB).managedSites
  const purged = await repo.purgeRevokedManagedSite({
    externalWorkspaceId: intent.externalWorkspaceId,
    workspaceId: intent.workspaceId,
    siteId: intent.siteId,
    ownerUserId: intent.ownerUserId,
    intentId: intent.id,
    now,
  })
  if (!purged) {
    // Two cases: the blog is claimed after all, or an earlier run already
    // deleted the rows. A blog that still lives must never be blocked by the
    // intent again, so it is released. A blog that is gone keeps the intent
    // as its trace: a paid webhook that arrives late must be recognised and
    // escalated, not turned into a paid workspace with no blog.
    const site = await env.DB.prepare('SELECT id FROM sites WHERE id = ?')
      .bind(intent.siteId)
      .first<{ id: string }>()
    if (site) {
      await repo.deletePurgeIntent(intent.siteId)
      console.warn('[managed-claim-sweep] purge did not delete rows, intent released', {
        workspaceId: intent.workspaceId,
        siteId: intent.siteId,
        at: now,
      })
      return false
    }
    await repo.completePurgeIntent(intent.siteId, now)
    console.log('[managed-claim-sweep] purged unclaimed managed blog, rows were already gone', {
      workspaceId: intent.workspaceId,
      siteId: intent.siteId,
      externalWorkspaceId: intent.externalWorkspaceId,
      ownerUserId: intent.ownerUserId,
      revokedAt: intent.revokedAt,
      at: now,
    })
    return true
  }
  await repo.completePurgeIntent(intent.siteId, now)
  // The audit trail: activity rows cascade away with the site, so this line
  // is the operational record that a blog was deleted.
  console.log('[managed-claim-sweep] purged unclaimed managed blog', {
    workspaceId: intent.workspaceId,
    siteId: intent.siteId,
    externalWorkspaceId: intent.externalWorkspaceId,
    ownerUserId: intent.ownerUserId,
    revokedAt: intent.revokedAt,
    at: now,
  })
  return true
}

async function purgeClaimSite(
  env: Cloudflare.Env,
  candidate: ManagedClaimSweepCandidate,
  now: number,
): Promise<boolean> {
  const repo = createDataAccess(env.DB).managedSites
  // The decision to delete, taken in one atomic write. It fails (and nothing
  // is deleted) when the blog was claimed, the plan resumed, the deadline
  // moved, or a claim checkout is still open.
  const intent = await repo.acquirePurgeIntent({
    externalWorkspaceId: candidate.externalWorkspaceId,
    workspaceId: candidate.workspaceId,
    siteId: candidate.siteId,
    ownerUserId: candidate.ownerUserId,
    bindingId: candidate.id,
    lifecycleRevision: candidate.lifecycleRevision,
    revokedAt: candidate.revokedAt,
    r2Prefixes: siteR2Prefixes(candidate.siteId),
    now,
  })
  if (!intent) {
    console.warn('[managed-claim-sweep] purge skipped, blog is not purgeable', {
      workspaceId: candidate.workspaceId,
      siteId: candidate.siteId,
      at: now,
    })
    return false
  }
  return await runPurgeIntent(env, intent, now)
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
  let remindersSent = 0
  let purged = 0
  let candidates = 0
  let cursor: { revokedAt: number; id: string } | null = null

  // Resume first: a run that died after taking an intent (or after deleting
  // the rows) left that intent behind, and the same resources must go.
  await repo.deleteExpiredClaimCheckoutAttempts(now)
  let intentCursor: string | null = null
  for (let page = 0; page < MAX_INTENT_PAGES; page++) {
    const intents = await repo.listPurgeIntents({ cursor: intentCursor })
    if (intents.length === 0) break
    for (const intent of intents) {
      try {
        if (await runPurgeIntent(workerEnv, intent, now)) purged += 1
      } catch (error) {
        // Per-site isolation: one broken site never blocks the rest, and the
        // intent stays for the next run.
        console.warn('[managed-claim-sweep] purge resume failed', {
          workspaceId: intent.workspaceId,
          siteId: intent.siteId,
          error: String(error),
        })
      }
    }
    intentCursor = intents[intents.length - 1]?.siteId ?? null
    if (!intentCursor) break
  }

  // Page through every eligible blog: a long queue of old blogs must never
  // starve the newer ones from their reminders.
  for (let page = 0; page < MAX_SWEEP_PAGES; page++) {
    const result = await repo.listClaimSweepCandidates({ now, cursor })
    candidates += result.candidates.length
    for (const candidate of result.candidates) {
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
    cursor = result.cursor
    if (!cursor) break
  }
  return { skipped: false, candidates, remindersSent, purged }
}
