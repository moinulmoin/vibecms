/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

import { afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { ABANDONED_SCHEDULE_ERROR, claimDueSchedules, createD1PostRepository, schedulePost } from '@vc/db';
import { archivePost, ConflictError, publishScheduledPost, unarchivePost, type Actor } from '@vc/core';
import { ABANDONED_SCHEDULE_CODE, processDueSchedules, SCHEDULE_FAILED_ACTION } from './post-scheduler';

const SITE = 'scheduler-regression-site';
const actor: Actor = { type: 'human', id: 'scheduler-user', name: 'Owner', role: 'owner' };
const repo = createD1PostRepository(env.DB);
let sequence = 0;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[]);
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .bind('scheduler-regression-ws', 'Scheduler', 'scheduler-regression-ws').run();
  await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
    .bind(SITE, 'scheduler-regression-ws', 'Scheduler', SITE).run();
});

async function post() {
  const id = `scheduler-post-${++sequence}`;
  return repo.createPostWithHistory({ id, siteId: SITE, title: id, slug: id,
    excerpt: null, contentMarkdown: 'Saved', coverAssetId: null, canonicalUrl: null,
    seoTitle: null, seoDescription: null, status: 'draft', publishedAt: null,
    tags: [], presentation: null }, actor,
  { changeSummary: 'Created', activityAction: 'post.created', activitySummary: 'Created' });
}

async function status(postId: string) {
  return env.DB.prepare('SELECT status, attempts, error, publish_at AS publishAt FROM post_schedules WHERE post_id = ?')
    .bind(postId).first<{ status: string; attempts: number; error: string | null; publishAt: number }>();
}

async function failureActivity(postId: string) {
  return (await env.DB.prepare(`SELECT actor_type AS actorType, entity_type AS entityType, summary
    FROM activity_events WHERE site_id = ? AND entity_id = ? AND action = ?`)
    .bind(SITE, postId, SCHEDULE_FAILED_ACTION).all<{ actorType: string; entityType: string; summary: string }>()).results;
}

/** Structured scheduler log lines emitted through console.error/warn/info. */
function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const keep = (value: unknown) => { if (typeof value === 'string' && value.startsWith('{')) lines.push(JSON.parse(value)) };
  for (const method of ['error', 'warn', 'info'] as const) vi.spyOn(console, method).mockImplementation(keep);
  return (event: string) => lines.filter((line) => line.event === event);
}

afterEach(() => { vi.restoreAllMocks() });

describe('minute scheduled publishing with a fake clock', () => {
  it('does not publish an old schedule after archive and restore', async () => {
    const item = await post();
    const clock = 1_800_003_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    await archivePost(repo, actor, { siteId: SITE, postId: item.id });
    // A repeat archive is a no-op: no second version or activity row.
    await archivePost(repo, actor, { siteId: SITE, postId: item.id });
    await unarchivePost(repo, actor, { siteId: SITE, postId: item.id });
    let calls = 0;
    expect(await processDueSchedules(env.DB, clock, async () => { calls++; }))
      .toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(calls).toBe(0);
    expect(await status(item.id)).toBeNull();
    const events = await env.DB.prepare("SELECT summary FROM activity_events WHERE entity_id = ? AND action = 'post.archived'")
      .bind(item.id).all<{ summary: string }>();
    expect(events.results.map((event) => event.summary)).toEqual([`Archived ${item.title} (scheduled publish canceled)`]);
  });

  it('invalidates a claimed lease before a restored post can be published', async () => {
    const item = await post();
    const clock = 1_800_004_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    const [claimed] = await claimDueSchedules(env.DB, clock);
    expect(claimed?.postId).toBe(item.id);
    await archivePost(repo, actor, { siteId: SITE, postId: item.id });
    await unarchivePost(repo, actor, { siteId: SITE, postId: item.id });
    await expect(publishScheduledPost(repo, { type: 'system', id: 'system', name: 'System' }, {
      siteId: SITE, postId: item.id, versionNumber: claimed!.versionNumber,
      billingStatus: 'active', scheduledBy: actor.name, leaseToken: claimed!.leaseToken!,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await repo.getPost(SITE, item.id))?.status).toBe('draft');
    expect(await status(item.id)).toBeNull();
  });
  it('ignores not-due work and processes a due version once', async () => {
    const item = await post();
    const clock = 1_800_000_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock + 10, actor, clock);
    const seen: string[] = [];
    expect(await processDueSchedules(env.DB, clock, async (entry) => { seen.push(entry.postId) }))
      .toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(await processDueSchedules(env.DB, clock + 10, async (entry) => { seen.push(entry.postId) }))
      .toEqual({ published: 1, failed: 0, retrying: 0 });
    expect(seen).toEqual([item.id]);
    expect(await status(item.id)).toMatchObject({ status: 'published', attempts: 1 });
  });

  it('marks a permanent slug conflict failed with the reason, logs it, and tells the owner', async () => {
    const item = await post();
    const clock = 1_800_001_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    const logs = captureLogs();
    expect(await processDueSchedules(env.DB, clock, async () => { throw new ConflictError('A post with this slug already exists') }))
      .toEqual({ published: 0, failed: 1, retrying: 0 });
    expect(await status(item.id)).toMatchObject({ status: 'failed', attempts: 1, error: 'A post with this slug already exists' });
    expect(logs('scheduled_publish_failed')).toEqual([expect.objectContaining({
      level: 'error', siteId: SITE, postId: item.id, versionNumber: 1, attempt: 1, errorCode: 'CONFLICT', permanent: true,
      error: 'A post with this slug already exists',
    })]);
    expect(logs('scheduled_publish_run')).toEqual([expect.objectContaining({
      attempted: 1, abandoned: 0, published: 0, failed: 1, retrying: 0, superseded: 0, finalizeErrors: 0,
    })]);
    expect(await failureActivity(item.id)).toEqual([{
      actorType: 'system', entityType: 'post',
      summary: `Failed to publish scheduled v1 of ${item.id} · A post with this slug already exists`,
    }]);
  });

  it('fails with Post was archived when archive wins before publication', async () => {
    const item = await post();
    const clock = 1_800_001_500;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    expect(await processDueSchedules(env.DB, clock, async (schedule) => {
      await repo.updatePostWithHistory(SITE, item.id, { status: 'archived' }, actor,
        { changeSummary: 'Archived', activityAction: 'post.archived', activitySummary: 'Archived' }, 1);
      await publishScheduledPost(repo, { type: 'system', id: 'system', name: 'System' }, {
        siteId: SITE, postId: item.id, versionNumber: schedule.versionNumber,
        billingStatus: 'active', scheduledBy: actor.name, leaseToken: schedule.leaseToken!,
      });
    })).toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(await status(item.id)).toBeNull();
    expect((await repo.getPost(SITE, item.id))?.status).toBe('archived');
  });

  it('retries a transient error only three times, logging retries apart from the final failure', async () => {
    const item = await post();
    const clock = 1_800_002_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    const logs = captureLogs();
    let calls = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await processDueSchedules(env.DB, clock + (attempt - 1) * 60, async () => {
        calls++;
        throw new Error('Temporary storage error');
      });
      expect(result[attempt === 3 ? 'failed' : 'retrying']).toBe(1);
      expect(await failureActivity(item.id)).toHaveLength(attempt === 3 ? 1 : 0);
    }
    expect(await processDueSchedules(env.DB, clock + 180, async () => { calls++ })).toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(calls).toBe(3);
    expect(await status(item.id)).toMatchObject({ status: 'failed', attempts: 3, publishAt: clock, error: 'Temporary storage error' });
    expect(logs('scheduled_publish_retry').map((line) => [line.postId, line.attempt, line.errorCode]))
      .toEqual([[item.id, 1, 'INTERNAL_ERROR'], [item.id, 2, 'INTERNAL_ERROR']]);
    expect(logs('scheduled_publish_failed')).toEqual([expect.objectContaining({ postId: item.id, attempt: 3, permanent: false })]);
    // Every tick logs a summary, including the final empty one.
    expect(logs('scheduled_publish_run').map((line) => [line.attempted, line.retrying, line.failed]))
      .toEqual([[1, 1, 0], [1, 1, 0], [1, 0, 1], [0, 0, 0]]);
  });

  it('records a crashed final attempt as published when its version already went live', async () => {
    const item = await post();
    const clock = 1_800_006_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    let lastClaim: Awaited<ReturnType<typeof claimDueSchedules>>[number] | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      [lastClaim] = await claimDueSchedules(env.DB, clock + attempt * 121);
    }
    // The final attempt's publish committed, then the worker died before finishing the schedule.
    await publishScheduledPost(repo, { type: 'system', id: 'system', name: 'System' }, {
      siteId: SITE, postId: item.id, versionNumber: 1,
      billingStatus: 'active', scheduledBy: actor.name, leaseToken: lastClaim!.leaseToken!,
    });
    const logs = captureLogs();
    expect(await processDueSchedules(env.DB, clock + 242 + 120, async () => {})).toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(await status(item.id)).toMatchObject({ status: 'published', error: null });
    expect(logs('scheduled_publish_failed')).toEqual([]);
    expect(await failureActivity(item.id)).toHaveLength(0);
  });

  it('fails, logs, and reports a schedule whose final attempt crashed mid-lease', async () => {
    const item = await post();
    const clock = 1_800_005_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    // Three claims that never finish: each worker died holding the lease.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await claimDueSchedules(env.DB, clock + attempt * 121)).map((entry) => entry.postId)).toEqual([item.id]);
    }
    const logs = captureLogs();
    let calls = 0;
    // Lease still fresh: neither reclaimed nor failed.
    expect(await processDueSchedules(env.DB, clock + 242 + 119, async () => { calls++ })).toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(await status(item.id)).toMatchObject({ status: 'processing', attempts: 3 });
    expect(await processDueSchedules(env.DB, clock + 242 + 120, async () => { calls++ })).toEqual({ published: 0, failed: 1, retrying: 0 });
    expect(calls).toBe(0);
    expect(await status(item.id)).toMatchObject({ status: 'failed', attempts: 3, error: ABANDONED_SCHEDULE_ERROR });
    expect(logs('scheduled_publish_failed')).toEqual([expect.objectContaining({
      siteId: SITE, postId: item.id, attempt: 3, errorCode: ABANDONED_SCHEDULE_CODE, permanent: false,
    })]);
    expect(logs('scheduled_publish_run')).toEqual([
      expect.objectContaining({ level: 'info', attempted: 0, abandoned: 0, published: 0, failed: 0, retrying: 0 }),
      expect.objectContaining({ level: 'error', attempted: 0, abandoned: 1, failed: 1 }),
    ]);
    expect(await failureActivity(item.id)).toHaveLength(1);
    // Reported once: the next tick neither re-fails nor re-reports it.
    expect(await processDueSchedules(env.DB, clock + 600, async () => { calls++ })).toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(await failureActivity(item.id)).toHaveLength(1);
  });

  it('still logs a failed run summary when schedule bookkeeping itself rejects', async () => {
    const item = await post();
    const clock = 1_800_006_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    const logs = captureLogs();
    let calls = 0;
    await env.DB.prepare('ALTER TABLE post_schedules RENAME TO post_schedules_offline').run();
    try {
      await expect(processDueSchedules(env.DB, clock, async () => { calls++ })).rejects.toThrow(/post_schedules/);
    } finally {
      await env.DB.prepare('ALTER TABLE post_schedules_offline RENAME TO post_schedules').run();
    }
    expect(calls).toBe(0);
    expect(logs('scheduled_publish_run')).toEqual([expect.objectContaining({
      level: 'error', now: clock, attempted: 0, abandoned: 0, published: 0, failed: 0, retrying: 0,
      errorCode: 'INTERNAL_ERROR', error: expect.stringContaining('post_schedules'),
    })]);
    // Nothing was claimed, so the schedule is untouched and the next healthy tick publishes it.
    expect(await status(item.id)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await processDueSchedules(env.DB, clock, async () => { calls++ })).toEqual({ published: 1, failed: 0, retrying: 0 });
    expect(calls).toBe(1);
  });
});
