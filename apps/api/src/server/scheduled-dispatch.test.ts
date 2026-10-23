import { describe, expect, inject, it } from 'vitest'
import { scheduledJobsForCron, type ScheduledJob } from '@/server/scheduled-dispatch'

declare module 'vitest' {
  interface ProvidedContext {
    deployedCrons: Record<'development' | 'production' | 'selfHost', string[]>
  }
}

// A cron string in wrangler config that no longer matches scheduled-dispatch falls
// back to media-only, so analytics, the claim sweep or publishing would silently stop.
const EVERY_JOB: ScheduledJob[] = ['analytics', 'media', 'posts', 'subpaths', 'managed-claim']

describe('deployed cron triggers', () => {
  it('schedule every background job in every deployment', () => {
    const missing = Object.fromEntries(
      Object.entries(inject('deployedCrons')).map(([deployment, crons]) => {
        const scheduled = new Set(crons.flatMap(scheduledJobsForCron))
        return [deployment, EVERY_JOB.filter((job) => !scheduled.has(job))]
      }),
    )
    expect(missing).toEqual({ development: [], production: [], selfHost: [] })
  })
})
