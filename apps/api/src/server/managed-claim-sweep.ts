/**
 * Daily "keep your blog" sweep for AutoSEOPilot-managed sites (claim window).
 *
 * Day 0 is the VibeCMS revoke (`revoked_at`): days 0-7 the blog serves
 * normally everywhere, day 7 it pauses on every ingress and the first
 * reminder goes out, and at day 30 an unclaimed blog is deleted — custom
 * hostnames, R2 objects, and every D1 row including (when the login belongs
 * to no other workspace) the user row. Runs on the existing 15-minute cron
 * (next to media recovery); no per-request timers.
 *
 * D1 allows 1,000 queries per Worker invocation (Workers Paid), so one run is
 * bounded by an explicit query budget (`SWEEP_QUERY_BUDGET`). Every D1 call
 * the sweep makes is counted, a unit of work (one reminder, one purge) only
 * starts when the budget still covers its worst case, and whatever does not
 * fit is left for the next run, 15 minutes later.
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
import { sendClaimReminderEmail, sendPurgeConflictEmail } from '@/server/email'

const DAY_SECONDS = 24 * 60 * 60

/**
 * D1 queries one sweep run may make. D1 allows 1,000 per Worker invocation
 * (Workers Paid; a `batch()` counts as one). The sweep shares its invocation
 * with media recovery (`reconcileMediaOperations`: one list plus at most
 * three queries for each of its 50 operations, about 151), so 500 leaves
 * roughly 350 queries of headroom. At 96 runs a day that is 48,000 queries a
 * day for the window: thousands of reminders or purges, far above the
 * revokes the managed plan produces.
 */
export const SWEEP_QUERY_BUDGET = 500
/** Of the budget, what resuming crashed purges may use, so they never starve new work. */
const INTENT_QUERY_SHARE = 200
/** Refund notices sent per run (one list, then one write per accepted mail). */
const REFUND_NOTICES_PER_RUN = 50
/** Candidates per page. */
const SWEEP_PAGE_SIZE = 200
/**
 * Worst-case D1 queries of each unit of work. Reminder: attempt marker,
 * reminder marker, released marker. Purge resume (`runPurgeIntent`): the
 * guarded delete batch, then at most a site read and the intent write. Purge
 * of a candidate: attempt marker, the intent write and its read, then the
 * resume.
 */
const REMINDER_QUERY_COST = 3
const RESUME_QUERY_COST = 3
const PURGE_QUERY_COST = 3 + RESUME_QUERY_COST

/** Counts the D1 queries of one run against its budget. */
class D1QueryBudget {
  used = 0
  constructor(readonly limit: number) {}
  remaining(): number {
    return this.limit - this.used
  }
  covers(queries: number): boolean {
    return this.remaining() >= queries
  }
  spend(): void {
    // A backstop: the unit-of-work checks keep the run below the budget, so
    // reaching this means a cost above is wrong. Refusing the query keeps the
    // invocation inside the D1 limit; every step is resumable.
    if (this.used >= this.limit) throw new Error('managed_claim_sweep_query_budget_exhausted')
    this.used += 1
  }
}

/**
 * The run's D1 binding: every query (a statement's `first`/`run`/`all`/`raw`,
 * a `batch`, an `exec`) is counted against the budget before it is sent.
 */
function budgetedD1(db: D1Database, budget: D1QueryBudget): D1Database {
  const unwrapped = new WeakMap<object, D1PreparedStatement>()
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const counted = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') {
          return (...values: unknown[]) => wrapStatement(target.bind(...values))
        }
        if (property === 'first' || property === 'run' || property === 'all' || property === 'raw') {
          const method = Reflect.get(target, property, target) as (...args: unknown[]) => unknown
          return (...args: unknown[]) => {
            budget.spend()
            return method.apply(target, args)
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    unwrapped.set(counted, statement)
    return counted
  }
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') return (query: string) => wrapStatement(target.prepare(query))
      if (property === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          budget.spend()
          return target.batch(statements.map((statement) => unwrapped.get(statement) ?? statement))
        }
      }
      if (property === 'exec') {
        return (query: string) => {
          budget.spend()
          return target.exec(query)
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

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
  db: D1Database,
  intent: ManagedPurgeIntent,
  now: number,
): Promise<boolean> {
  for (const hostnameId of intent.hostnameIds) {
    // Fail-open by contract: a stale CF hostname does not block the purge.
    await deleteCustomHostname(hostnameId)
  }
  await purgeR2Prefixes(env.ASSETS_BUCKET, intent.r2Prefixes)

  const repo = createDataAccess(db).managedSites
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
    const site = await db.prepare('SELECT id FROM sites WHERE id = ?')
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
  db: D1Database,
  candidate: ManagedClaimSweepCandidate,
  now: number,
): Promise<boolean> {
  const repo = createDataAccess(db).managedSites
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
  return await runPurgeIntent(env, db, intent, now)
}

export interface ManagedClaimSweepResult {
  skipped: boolean
  candidates: number
  remindersSent: number
  purged: number
  refundNotices: number
  /** D1 queries this run made; never above `SWEEP_QUERY_BUDGET`. */
  queries: number
}

/**
 * The sweep entry (15-minute cron): reminders at days 7/14/21/28, purge at
 * day 30, inside one D1 query budget per run.
 */
export async function runManagedClaimSweep(
  workerEnv: Cloudflare.Env,
  options?: { maxCandidates?: number; queryBudget?: number },
): Promise<ManagedClaimSweepResult> {
  if (String(workerEnv.SELF_HOSTED) === 'true') {
    return { skipped: true, candidates: 0, remindersSent: 0, purged: 0, refundNotices: 0, queries: 0 }
  }
  const now = Math.floor(Date.now() / 1000)
  const budget = new D1QueryBudget(Math.max(0, options?.queryBudget ?? SWEEP_QUERY_BUDGET))
  const db = budgetedD1(workerEnv.DB, budget)
  const repo = createDataAccess(db).managedSites
  const maxCandidates = Math.max(1, options?.maxCandidates ?? Number.MAX_SAFE_INTEGER)
  let remindersSent = 0
  let purged = 0
  let candidates = 0
  let refundNotices = 0
  let cursor: { attemptAt: number; revokedAt: number; id: string } | null = null
  const result = (): ManagedClaimSweepResult => ({
    skipped: false,
    candidates,
    remindersSent,
    purged,
    refundNotices,
    queries: budget.used,
  })

  // Refund notices that were never accepted. The record of a paid claim for
  // a deleted blog is durable, and the notice is only marked as sent when
  // the mail was accepted, so a lost mail is sent again here instead of
  // being forgotten.
  if (!budget.covers(1 + REFUND_NOTICES_PER_RUN)) return result()
  for (const conflict of await repo.listUnnotifiedPurgeConflicts(REFUND_NOTICES_PER_RUN)) {
    try {
      await sendPurgeConflictEmail({
        workspaceId: conflict.workspaceId,
        siteId: conflict.siteId,
        polarCustomerId: conflict.polarCustomerId,
        polarSubscriptionId: conflict.polarSubscriptionId,
        polarOrderId: conflict.polarOrderId,
        polarCheckoutId: conflict.polarCheckoutId,
        eventType: conflict.eventType,
        eventId: conflict.eventId,
      })
      await repo.markPurgeConflictNotified(conflict.id, now)
      refundNotices += 1
    } catch (error) {
      console.warn('[managed-claim-sweep] refund notice failed', {
        conflictId: conflict.id,
        error: String(error),
      })
    }
  }

  // Resume first: a run that died after taking an intent (or after deleting
  // the rows) left that intent behind, and the same resources must go. The
  // resumes get their own share of the budget, so a pile of crashed purges
  // never starves the reminders.
  if (!budget.covers(1)) return result()
  await repo.deleteExpiredClaimCheckoutAttempts(now)
  const intentBudgetEnd = budget.used + INTENT_QUERY_SHARE
  let intentCursor: string | null = null
  for (;;) {
    const affordable = Math.floor(
      (Math.min(intentBudgetEnd - budget.used, budget.remaining()) - 1) / RESUME_QUERY_COST,
    )
    if (affordable < 1) break
    const intents = await repo.listPurgeIntents({ cursor: intentCursor, limit: Math.min(100, affordable) })
    if (intents.length === 0) break
    for (const intent of intents) {
      try {
        if (await runPurgeIntent(workerEnv, db, intent, now)) purged += 1
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

  // Collect the blogs that have something due BEFORE acting on any of them.
  // The attempt markers move the rows in the queue, so the pages have to be
  // read while the order is still the one the query ordered. A blog the
  // sweep cannot act on yet rotates to the back, so it never takes the slot
  // of a blog that is still waiting for its reminder. Only as many blogs are
  // read as the budget can still act on; a blog that is read but not acted
  // on keeps its place at the front of the queue for the next run.
  const due: ManagedClaimSweepCandidate[] = []
  for (;;) {
    const affordable = Math.floor((budget.remaining() - 1) / REMINDER_QUERY_COST) - due.length
    const remaining = Math.min(maxCandidates - due.length, affordable)
    if (remaining <= 0) break
    const page = await repo.listClaimSweepCandidates({
      now,
      cursor,
      limit: Math.min(SWEEP_PAGE_SIZE, remaining),
    })
    due.push(...page.candidates)
    cursor = page.cursor
    if (!cursor) break
  }
  for (const candidate of due) {
    const elapsed = now - candidate.revokedAt
    const deadline = candidate.revokedAt + MANAGED_CLAIM_WINDOW.windowSeconds
    const purgeDue = elapsed >= MANAGED_CLAIM_WINDOW.windowSeconds
    // The rest of the queue waits for the next run.
    if (!budget.covers(purgeDue ? PURGE_QUERY_COST : REMINDER_QUERY_COST)) break
    candidates += 1
    try {
      // The sweep tried this blog. If it cannot act on it yet, the marker
      // sends it to the back of the queue for the next run.
      await repo.markClaimSweepAttempt(candidate.externalWorkspaceId, now)
      if (purgeDue) {
        // Past the deadline the blog is deleted, not reminded about.
        if (await purgeClaimSite(workerEnv, db, candidate, now)) purged += 1
        continue
      }
      const reminder = latestDueReminder(elapsed)
      if (!reminder || reminderMarker(candidate, reminder.day) !== null) continue
      // Claim the marker first: at most one reminder per day-slot of this
      // window, even with overlapping cron runs. The claim is bound to the
      // window the candidate was read in, so a run that read an older window
      // can never mark (and skip) a slot of a newer one.
      const window = { revokedAt: candidate.revokedAt, lifecycleRevision: candidate.lifecycleRevision }
      const claimed = await repo.markClaimReminderSent(
        candidate.externalWorkspaceId,
        reminder.day as ManagedClaimReminderDay,
        now,
        window,
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
          window,
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
  return result()
}
