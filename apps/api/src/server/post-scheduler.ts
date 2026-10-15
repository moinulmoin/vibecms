import { publishScheduledPost, type Actor } from '@vc/core';
import {
  claimDueSchedules, createActivityRepository, createD1PostRepository, createDataAccess, failAbandonedSchedules,
  finishSchedule, type PostSchedule,
} from '@vc/db';
import { billingStatusForCore, resolveEffectiveEntitlementForSite } from './effective-entitlement';
import { assertPostImagesPublishable } from './publishing-images';
import { resolvePublishedVersionSlug, scheduleLiveArticlePurges } from './post-live-purge';
import { redactErrorText } from './request-logging';

const scheduler: Actor = { type: 'system', id: 'system', name: 'System' };
const MAX_ATTEMPTS = 3;
const PERMANENT_CODES = ['BILLING_REQUIRED', 'CONFLICT', 'VALIDATION_ERROR', 'NOT_FOUND', 'IMAGE_ALT_REQUIRED', 'INVALID_COVER_ASSET'];
/** Final attempt crashed mid-lease; the row was failed by failAbandonedSchedules. */
export const ABANDONED_SCHEDULE_CODE = 'ATTEMPTS_EXHAUSTED';
/** Activity action shown in the dashboard feed when a schedule stops for good. */
export const SCHEDULE_FAILED_ACTION = 'post.schedule_failed';

export type ScheduleRunResult = { published: number; failed: number; retrying: number };

function errorCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? (error as Error & { code: unknown }).code : undefined;
  return typeof code === 'string' && code ? code : 'INTERNAL_ERROR';
}

export function isPermanentScheduleError(error: unknown) {
  return error instanceof Error && 'code' in error && PERMANENT_CODES.includes(errorCode(error));
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

function scheduleFields(schedule: PostSchedule) {
  return { siteId: schedule.siteId, postId: schedule.postId, versionNumber: schedule.versionNumber, attempt: schedule.attempts, maxAttempts: MAX_ATTEMPTS };
}

/** Owner-visible record of a terminal failure. The schedule row is already failed; a feed write error is logged, not thrown. */
async function recordTerminalFailure(db: D1Database, schedule: PostSchedule, code: string, reason: string) {
  try {
    const version = await createD1PostRepository(db).getPostVersion(schedule.siteId, schedule.postId, schedule.versionNumber);
    const subject = version?.title ? `scheduled v${schedule.versionNumber} of ${version.title}` : `scheduled v${schedule.versionNumber}`;
    await createActivityRepository(db).create({
      siteId: schedule.siteId,
      actor: scheduler,
      action: SCHEDULE_FAILED_ACTION,
      entityType: 'post',
      entityId: schedule.postId,
      summary: `Failed to publish ${subject} · ${reason}`,
    });
  } catch (error) {
    log('error', 'scheduled_publish_activity_failed', { ...scheduleFields(schedule), errorCode: code, error: redactErrorText(String(error)) });
  }
}

async function reportTerminalFailure(db: D1Database, schedule: PostSchedule, code: string, reason: string, permanent: boolean) {
  log('error', 'scheduled_publish_failed', { ...scheduleFields(schedule), errorCode: code, permanent, error: redactErrorText(reason) });
  await recordTerminalFailure(db, schedule, code, reason);
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
): Promise<ScheduleRunResult> {
  const counts: ScheduleRunResult = { published: 0, failed: 0, retrying: 0 };
  let attempted = 0;
  let abandoned = 0;
  let superseded = 0;
  let finalizeErrors = 0;
  let firstFinalizeError: unknown;
  // Claim/expiry query failure: nothing was claimed past this point; leases stay bounded by the two-minute reclaim.
  let runError: unknown;

  try {
    for (const schedule of await failAbandonedSchedules(db, now)) {
      abandoned++;
      counts.failed++;
      await reportTerminalFailure(db, schedule, ABANDONED_SCHEDULE_CODE, schedule.error ?? 'Scheduled publish stopped', false);
    }

    const due = await claimDueSchedules(db, now);
    attempted = due.length;
    for (const schedule of due) {
      let outcome: 'published' | 'failed' | 'pending' = 'published';
      let code: string | null = null;
      let reason: string | null = null;
      let permanent = false;
      try {
        await publish(schedule);
      } catch (error) {
        code = errorCode(error);
        permanent = isPermanentScheduleError(error);
        outcome = permanent || schedule.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        reason = (error instanceof Error ? error.message : 'Scheduled publish failed').slice(0, 500);
      }

      let applied: boolean;
      try {
        applied = await finishSchedule(db, schedule, outcome, reason, now);
      } catch (error) {
        // The lease stays 'processing'; the next run reclaims it after two minutes
        // (or fails it as abandoned on the last attempt). Keep processing the batch.
        finalizeErrors++;
        firstFinalizeError ??= error;
        log('error', 'scheduled_publish_finalize_failed', {
          ...scheduleFields(schedule), outcome, errorCode: code, publishError: redactErrorText(reason ?? undefined), error: redactErrorText(String(error)),
        });
        continue;
      }

      if (!applied) {
        // Lease lost (archived, rescheduled, or reclaimed); its new owner reports the outcome.
        superseded++;
        log('warn', 'scheduled_publish_superseded', { ...scheduleFields(schedule), outcome, errorCode: code, error: redactErrorText(reason ?? undefined) });
        continue;
      }
      if (outcome === 'published') {
        counts.published++;
      } else if (outcome === 'pending') {
        counts.retrying++;
        log('warn', 'scheduled_publish_retry', { ...scheduleFields(schedule), errorCode: code, error: redactErrorText(reason ?? undefined) });
      } else {
        counts.failed++;
        await reportTerminalFailure(db, schedule, code!, reason!, permanent);
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    // Logged on every tick, including empty and rejected ones, as the scheduler heartbeat.
    log(runError || counts.failed || finalizeErrors ? 'error' : counts.retrying || superseded ? 'warn' : 'info', 'scheduled_publish_run', {
      now, attempted, abandoned, ...counts, superseded, finalizeErrors,
      ...(runError ? { errorCode: errorCode(runError), error: redactErrorText(String(runError)) } : {}),
    });
  }
  if (runError) throw runError;
  if (finalizeErrors) throw firstFinalizeError;
  return counts;
}
