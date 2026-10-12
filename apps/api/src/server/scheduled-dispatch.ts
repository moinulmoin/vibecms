import { runAnalyticsRollup } from '@/server/analytics-rollup'
import { reconcileMediaOperations } from '@/server/media-reconciler'
import { processDueSchedules } from '@/server/post-scheduler'
import { recheckActiveSubpathLocations } from '@/server/subpath-recheck'

/** Daily analytics + media reconcile + subpath re-check cron (existing). */
export const ANALYTICS_CRON = '17 2 * * *'
/** Frequent media recovery so failed uploads cannot hold quota overnight. */
export const MEDIA_RECONCILE_CRON = '*/15 * * * *'
export const POST_PUBLISH_CRON = '* * * * *'

export type ScheduledJob = 'analytics' | 'media' | 'posts' | 'subpaths'

/** Map Cloudflare ScheduledController.cron to the jobs that should run. */
export function scheduledJobsForCron(cron: string): ScheduledJob[] {
  if (cron === ANALYTICS_CRON) return ['analytics', 'media', 'subpaths']
  if (cron === POST_PUBLISH_CRON) return ['posts']
  // 15-minute tick (and any unexpected cron): media only — never analytics.
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
  if (jobs.includes('posts')) tasks.push(processDueSchedules(workerEnv.DB))
  await Promise.all(tasks)
  return { jobs }
}
