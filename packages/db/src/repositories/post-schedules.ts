import type { Actor } from '@vc/core';

export type PostSchedule = {
  postId: string; siteId: string; versionNumber: number; publishAt: number;
  status: 'pending' | 'processing' | 'published' | 'failed';
  error: string | null; attempts: number; scheduledByName: string;
  leaseToken: string | null;
};

export async function schedulePost(db: D1Database, siteId: string, postId: string,
  versionNumber: number, publishAt: number, actor: Actor, now: number): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO post_schedules
    (post_id, site_id, version_number, publish_at, status, error, attempts,
     scheduled_by_type, scheduled_by_id, scheduled_by_name, created_at, updated_at)
    SELECT p.id, p.site_id, ?, ?, 'pending', NULL, 0, ?, ?, ?, ?, ?
    FROM posts p JOIN post_versions v ON v.post_id = p.id AND v.site_id = p.site_id AND v.version_number = ?
    WHERE p.site_id = ? AND p.id = ? AND p.status <> 'archived'
    ON CONFLICT(post_id) DO UPDATE SET version_number = excluded.version_number,
      publish_at = excluded.publish_at, status = 'pending', error = NULL, attempts = 0, lease_token = NULL,
      scheduled_by_type = excluded.scheduled_by_type, scheduled_by_id = excluded.scheduled_by_id,
      scheduled_by_name = excluded.scheduled_by_name, updated_at = excluded.updated_at
      WHERE post_schedules.status <> 'processing'`)
    .bind(versionNumber, publishAt, actor.type, actor.id, actor.name, now, now, versionNumber, siteId, postId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function unschedulePost(db: D1Database, siteId: string, postId: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM post_schedules WHERE site_id = ? AND post_id = ?
    AND status IN ('pending', 'failed')`).bind(siteId, postId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function claimDueSchedules(db: D1Database, now: number, limit = 25): Promise<PostSchedule[]> {
  // A crashed worker's processing lease becomes due again after two minutes.
  await db.prepare(`UPDATE post_schedules SET status = 'failed', error = 'Scheduled publish stopped after 3 attempts',
    updated_at = ? WHERE status = 'processing' AND attempts >= 3 AND updated_at <= ?`)
    .bind(now, now - 120).run();
  const candidates = await db.prepare(`SELECT post_id AS postId, site_id AS siteId,
      version_number AS versionNumber, publish_at AS publishAt, status, error, attempts,
      scheduled_by_name AS scheduledByName, lease_token AS leaseToken
    FROM post_schedules WHERE attempts < 3 AND ((status = 'pending' AND publish_at <= ?
      AND (attempts = 0 OR updated_at <= ?))
      OR (status = 'processing' AND updated_at <= ?))
    ORDER BY publish_at LIMIT ?`).bind(now, now - 60, now - 120, limit).all<PostSchedule>();
  const claimed: PostSchedule[] = [];
  for (const schedule of candidates.results) {
    const leaseToken = crypto.randomUUID();
    const result = await db.prepare(`UPDATE post_schedules SET status = 'processing', attempts = attempts + 1,
      lease_token = ?, updated_at = ? WHERE site_id = ? AND post_id = ? AND version_number = ? AND attempts = ?
      AND ((status = 'pending' AND publish_at <= ? AND (attempts = 0 OR updated_at <= ?))
        OR (status = 'processing' AND updated_at <= ?))`)
      .bind(leaseToken, now, schedule.siteId, schedule.postId, schedule.versionNumber, schedule.attempts, now, now - 60, now - 120).run();
    if ((result.meta.changes ?? 0) > 0) claimed.push({ ...schedule, status: 'processing', attempts: schedule.attempts + 1, leaseToken });
  }
  return claimed;
}

export async function finishSchedule(db: D1Database, schedule: PostSchedule,
  outcome: 'published' | 'failed' | 'pending', error: string | null, now: number): Promise<boolean> {
  const result = await db.prepare(`UPDATE post_schedules SET status = ?, error = ?, lease_token = NULL,
    updated_at = ? WHERE site_id = ? AND post_id = ? AND version_number = ? AND status = 'processing' AND lease_token = ?`)
    .bind(outcome, error, now, schedule.siteId, schedule.postId, schedule.versionNumber, schedule.leaseToken).run();
  return (result.meta.changes ?? 0) > 0;
}
