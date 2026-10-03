import { publishScheduledPost, type Actor } from '@vc/core';
import { claimDueSchedules, createD1PostRepository, finishSchedule, type PostSchedule, createDataAccess } from '@vc/db';
import { billingStatusForCore, resolveEffectiveEntitlementForSite } from './effective-entitlement';
import { assertPostImagesPublishable } from './publishing-images';
import { resolvePublishedVersionSlug, scheduleLiveArticlePurges } from './post-live-purge';

const scheduler: Actor = { type: 'system', id: 'system', name: 'System' };

export function isPermanentScheduleError(error: unknown) {
  return error instanceof Error && ('code' in error) &&
    ['BILLING_REQUIRED', 'CONFLICT', 'VALIDATION_ERROR', 'NOT_FOUND', 'IMAGE_ALT_REQUIRED', 'INVALID_COVER_ASSET']
      .includes(String((error as Error & { code: unknown }).code));
}

export async function processDueSchedules(
  db: D1Database,
  now: number = Math.floor(Date.now() / 1000),
  publish: (schedule: PostSchedule) => Promise<void> = async (schedule) => {
    const repo = createD1PostRepository(db);
    const previousLiveSlug = await resolvePublishedVersionSlug(repo, schedule.siteId, schedule.postId);
    await assertPostImagesPublishable(schedule.siteId, schedule.postId, schedule.versionNumber);
    const entitlement = await resolveEffectiveEntitlementForSite(schedule.siteId);
    const result = await publishScheduledPost(repo, scheduler, {
      siteId: schedule.siteId,
      postId: schedule.postId,
      versionNumber: schedule.versionNumber,
      billingStatus: billingStatusForCore(entitlement),
      scheduledBy: schedule.scheduledByName,
      leaseToken: schedule.leaseToken!,
    });
    const siteSlug = await createDataAccess(db).sites.getSiteSlug(schedule.siteId);
    if (siteSlug) scheduleLiveArticlePurges(schedule.siteId, siteSlug, previousLiveSlug, result.publishedSlug ?? result.slug);
  },
): Promise<{ published: number; failed: number; retrying: number }> {
  const due = await claimDueSchedules(db, now);
  const counts = { published: 0, failed: 0, retrying: 0 };
  for (const schedule of due) {
    try {
      await publish(schedule);
      if (await finishSchedule(db, schedule, 'published', null, now)) counts.published++;
    } catch (error) {
      const final = isPermanentScheduleError(error) || schedule.attempts >= 3;
      const message = error instanceof Error ? error.message : 'Scheduled publish failed';
      if (await finishSchedule(db, schedule, final ? 'failed' : 'pending', message.slice(0, 500), now)) {
        counts[final ? 'failed' : 'retrying']++;
      }
    }
  }
  return counts;
}
