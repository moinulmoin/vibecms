import { runAnalyticsRollup } from '@/server/analytics-rollup'
import { runManagedClaimSweep } from '@/server/managed-claim-sweep'
import { reconcileMediaOperations } from '@/server/media-reconciler'
import { processDueSchedules } from '@/server/post-scheduler'
import { recheckActiveSubpathLocations } from '@/server/subpath-recheck'

/** Historical daily trigger, now media reconcile + subpath re-check only. */
export const ANALYTICS_CRON = '17 2 * * *'
/**
 * Frequent media recovery, claim-window sweep and resumable analytics.
 * D1 budgets: claims 500 + analytics 250 + media at most 201 = 951 < 1,000.
 * Analytics' durable per-site cursor skips sites already refreshed today.
 */
export const MEDIA_RECONCILE_CRON = '*/15 * * * *'
export const POST_PUBLISH_CRON = '* * * * *'

export type ScheduledJob = 'analytics' | 'media' | 'posts' | 'subpaths' | 'managed-claim'

/** Map Cloudflare ScheduledController.cron to the jobs that should run. */
export function scheduledJobsForCron(cron: string): ScheduledJob[] {
  if (cron === ANALYTICS_CRON) return ['media', 'subpaths']
  if (cron === MEDIA_RECONCILE_CRON) return ['media', 'managed-claim', 'analytics']
  if (cron === POST_PUBLISH_CRON) return ['posts']
  // Any unexpected cron: media only — never analytics, never the sweep.
  return ['media']
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
  await Promise.all(tasks)
  return { jobs }
}
