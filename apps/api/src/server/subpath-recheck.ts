import { createDataAccess } from '@vc/db'
import { redactProxyLinks } from '@vc/core'
import { checkSubpathSetup } from '@/server/subpath-setup'

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
 */
const SUBPATH_RECHECK_LIMIT = 200
const SUBPATH_RECHECK_CONCURRENCY = 8
const SUBPATH_RECHECK_BUDGET_MS = 10 * 60 * 1000

export async function recheckActiveSubpathLocations(
  db: D1Database,
  options: { now?: () => number } = {},
): Promise<{ checked: number }> {
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
        await data.domains.recordSubpathCheck(row.id, row.siteId, {
          proxyId: row.proxyId ?? '',
          checkPassed: result.ok,
          verificationErrorsJson: JSON.stringify(result),
        })
        checked++
      } catch (error) {
        // A broken row must not abort the rest of the sweep; keep proxy ids
        // out of the logs in case the error message carries a probed URL.
        console.warn('subpath re-check failed', row.id, redactProxyLinks(error instanceof Error ? error.message : String(error)))
      }
    }
  }
  await Promise.all(Array.from({ length: SUBPATH_RECHECK_CONCURRENCY }, () => worker()))
  return { checked }
}
