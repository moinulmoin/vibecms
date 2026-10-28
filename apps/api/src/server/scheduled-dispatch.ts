import { runAnalyticsRollup } from '@/server/analytics-rollup'
import { runManagedClaimSweep } from '@/server/managed-claim-sweep'
import { reconcileMediaOperations } from '@/server/media-reconciler'
import { revokeGrant } from '@/server/oauth'
import { processDueSchedules } from '@/server/post-scheduler'
import { recheckActiveSubpathLocations } from '@/server/subpath-recheck'

/** Daily media reconcile and subpath re-check. */
export const ANALYTICS_CRON = '17 2 * * *'
/**
 * Frequent media recovery, claim-window sweep, resumable analytics and OAuth cleanup.
 * Analytics' durable per-site cursor skips sites already refreshed today.
 */
export const MEDIA_RECONCILE_CRON = '*/15 * * * *'
export const POST_PUBLISH_CRON = '* * * * *'

export type ScheduledJob = 'analytics' | 'media' | 'posts' | 'subpaths' | 'managed-claim' | 'oauth-cleanup'

/** Map Cloudflare ScheduledController.cron to the jobs that should run. */
export function scheduledJobsForCron(cron: string): ScheduledJob[] {
  if (cron === ANALYTICS_CRON) return ['media', 'subpaths']
  if (cron === MEDIA_RECONCILE_CRON) return ['media', 'managed-claim', 'analytics', 'oauth-cleanup']
  if (cron === POST_PUBLISH_CRON) return ['posts']
  // Any unexpected cron: media only — never analytics, never the sweep.
  return ['media']
}

async function cleanupOAuth(db: D1Database) {
  const now = Math.floor(Date.now() / 1000)
  const abandoned = await db.prepare(`SELECT a.id, a.api_key_id
    FROM oauth_authorizations a JOIN api_keys k ON k.id = a.api_key_id
    WHERE a.status = 'approved' AND a.code_expires_at < ? AND k.revoked_at IS NULL
    LIMIT 500`).bind(now - 300).all<{ id: string; api_key_id: string }>()
  for (const authorization of abandoned.results) {
    await revokeGrant(db, authorization.api_key_id, now, 'abandoned', authorization.id)
  }

  const deleteInBatches = async (statement: D1PreparedStatement) => {
    for (let i = 0; i < 20; i++) {
      const result = await statement.run()
      if ((result.meta.changes ?? 0) < 500) break
    }
  }

  await deleteInBatches(db.prepare(`DELETE FROM oauth_authorizations WHERE id IN
    (SELECT a.id FROM oauth_authorizations a WHERE a.expires_at < ? AND
      (a.status != 'approved' OR EXISTS (
        SELECT 1 FROM api_keys k WHERE k.id = a.api_key_id AND k.revoked_at IS NOT NULL
      )) LIMIT 500)`).bind(now - 86400))
  await deleteInBatches(db.prepare(`DELETE FROM oauth_tokens WHERE token_hash IN
    (SELECT token_hash FROM oauth_tokens WHERE
      (kind = 'access' AND expires_at < ?) OR (kind = 'refresh' AND expires_at < ?)
      LIMIT 500)`).bind(now - 86400, now - 7 * 86400))
  await deleteInBatches(db.prepare(`DELETE FROM oauth_clients WHERE id IN
    (SELECT c.id FROM oauth_clients c WHERE c.registration = 'dcr' AND c.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.oauth_client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM oauth_authorizations a WHERE a.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.client_id = c.id)
      LIMIT 500)`).bind(now - 30 * 86400))
}

export async function runScheduledJobs(
  cron: string,
  workerEnv: Cloudflare.Env,
): Promise<{ jobs: ScheduledJob[] }> {
  const jobs = scheduledJobsForCron(cron)
  const tasks: Promise<unknown>[] = []
  if (jobs.includes('analytics')) tasks.push(runAnalyticsRollup(workerEnv))
  if (jobs.includes('media')) tasks.push(reconcileMediaOperations(workerEnv))
  if (jobs.includes('subpaths')) tasks.push(recheckActiveSubpathLocations(workerEnv.DB))
  if (jobs.includes('managed-claim')) tasks.push(runManagedClaimSweep(workerEnv))
  if (jobs.includes('posts')) tasks.push(processDueSchedules(workerEnv.DB))
  if (jobs.includes('oauth-cleanup')) tasks.push(cleanupOAuth(workerEnv.DB))
  await Promise.all(tasks)
  return { jobs }
}
