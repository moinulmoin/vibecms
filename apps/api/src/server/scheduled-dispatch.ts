import { runAnalyticsRollup } from '@/server/analytics-rollup'
import { reconcileMediaOperations } from '@/server/media-reconciler'

/** Daily analytics + media reconcile cron (existing). */
export const ANALYTICS_CRON = '17 2 * * *'
/** Frequent media recovery so failed uploads cannot hold quota overnight. */
export const MEDIA_RECONCILE_CRON = '*/15 * * * *'

export type ScheduledJob = 'analytics' | 'media'

/** Map Cloudflare ScheduledController.cron to the jobs that should run. */
export function scheduledJobsForCron(cron: string): ScheduledJob[] {
  if (cron === ANALYTICS_CRON) return ['analytics', 'media']
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
  await Promise.all(tasks)
  return { jobs }
}
