import { createDataAccess } from '@vc/db'
import { redactProxyLinks, type Actor } from '@vc/core'
import { checkSubpathSetup } from '@/server/subpath-setup'
import { scheduleManagedSitePurge } from '@/server/purge-scheduler'

/**
 * Daily re-check of every ACTIVE subpath location (plans/022 §10): records the
 * latest probe result on the row for the dashboard, but NEVER demotes — a
 * flaky probe must not flip canonical URLs or unpublish a location. Only the
 * owner removes a mount.
 *
 * A probe can hang for its full 8s timeout, so a serial sweep of 200 rows
 * (~1600s) would blow Cloudflare's 900s Cron Trigger limit. We run a small
 * pool and stop starting new checks at a wall-clock budget well under the
 * limit; rows we did not reach are the least-recently-checked, so the next
 * day's sweep picks them first.
 *
 * The same job prunes never-active subpath claims older than 30 days (bounded
 * per run): a pending claim proves nothing and blocks no one, but abandoned
 * rows should not pile up.
 */
const SUBPATH_RECHECK_LIMIT = 200
const SUBPATH_RECHECK_CONCURRENCY = 8
const SUBPATH_RECHECK_BUDGET_MS = 10 * 60 * 1000
const SUBPATH_CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60
const SUBPATH_PRUNE_LIMIT = 500

// Demoted rows are a platform-driven outcome on the losing site, not an action
// its users took — the activity entry is attributed to System.
const SYSTEM_ACTOR: Actor = { type: 'system', id: 'system', name: 'System' }

export async function recheckActiveSubpathLocations(
  db: D1Database,
  options: { now?: () => number } = {},
): Promise<{ checked: number; pruned: number }> {
  const now = options.now ?? (() => Date.now())
  const deadline = now() + SUBPATH_RECHECK_BUDGET_MS
  const data = createDataAccess(db)
  const rows = await data.domains.listActiveSubpaths(SUBPATH_RECHECK_LIMIT)
  let next = 0
  let checked = 0
  const worker = async () => {
    while (next < rows.length && now() < deadline) {
      const row = rows[next++]!
      try {
        const result = await checkSubpathSetup(row, { id: row.siteId })
        const { demoted } = await data.domains.recordSubpathCheck(row.id, row.siteId, {
          proxyId: row.proxyId ?? '',
          checkPassed: result.ok,
          verificationErrorsJson: JSON.stringify(result),
        })
        // A re-check that PASSES proves the hostname moved to this site's
        // mount: the loser is told and its cached mount purged.
        for (const loser of demoted) {
          const loserSlug = await data.sites.getSiteSlug(loser.siteId)
          if (loserSlug) scheduleManagedSitePurge(db, loser.siteId, loserSlug)
          await data.activity.create({
            siteId: loser.siteId,
            actor: SYSTEM_ACTOR,
            action: 'site.location.superseded',
            entityType: 'site',
            entityId: loser.siteId,
            summary: `The blog location at ${loser.hostname}${loser.basePath ?? ''} now points at another blog.`,
          })
        }
        checked++
      } catch (error) {
        // A broken row must not abort the rest of the sweep; keep proxy ids
        // out of the logs in case the error message carries a probed URL.
        console.warn('subpath re-check failed', row.id, redactProxyLinks(error instanceof Error ? error.message : String(error)))
      }
    }
  }
  await Promise.all(Array.from({ length: SUBPATH_RECHECK_CONCURRENCY }, () => worker()))
  const staleBefore = Math.floor(now() / 1000) - SUBPATH_CLAIM_TTL_SECONDS
  const pruned = await data.domains.deleteStaleSubpathClaims(staleBefore, SUBPATH_PRUNE_LIMIT)
  return { checked, pruned }
}
