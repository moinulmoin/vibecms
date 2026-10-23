import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_CRON,
  MEDIA_RECONCILE_CRON,
  POST_PUBLISH_CRON,
  scheduledJobsForCron,
} from '@/server/scheduled-dispatch'

describe('scheduledJobsForCron', () => {
  it('runs media and the subpath re-check on the daily cron', () => {
    expect(scheduledJobsForCron(ANALYTICS_CRON)).toEqual(['media', 'subpaths'])
  })

  it('runs media, the claim sweep and resumable analytics on the 15-minute cron', () => {
    expect(scheduledJobsForCron(MEDIA_RECONCILE_CRON)).toEqual(['media', 'managed-claim', 'analytics'])
  })

  it('runs due post publishing on the minute cron', () => {
    expect(scheduledJobsForCron(POST_PUBLISH_CRON)).toEqual(['posts'])
  })

  it('does not schedule analytics for an unexpected cron string', () => {
    expect(scheduledJobsForCron('0 * * * *')).toEqual(['media'])
  })
})
