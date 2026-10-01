/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

import { beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { claimDueSchedules, createD1PostRepository, schedulePost } from '@vc/db';
import { archivePost, ConflictError, publishScheduledPost, unarchivePost, type Actor } from '@vc/core';
import { processDueSchedules } from './post-scheduler';

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

  it('marks a permanent slug conflict failed with the reason', async () => {
    const item = await post();
    const clock = 1_800_001_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    expect(await processDueSchedules(env.DB, clock, async () => { throw new ConflictError('A post with this slug already exists') }))
      .toEqual({ published: 0, failed: 1, retrying: 0 });
    expect(await status(item.id)).toMatchObject({ status: 'failed', attempts: 1, error: 'A post with this slug already exists' });
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

  it('retries a transient error only three times', async () => {
    const item = await post();
    const clock = 1_800_002_000;
    await schedulePost(env.DB, SITE, item.id, 1, clock, actor, clock - 10);
    let calls = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await processDueSchedules(env.DB, clock + (attempt - 1) * 60, async () => {
        calls++;
        throw new Error('Temporary storage error');
      });
      expect(result[attempt === 3 ? 'failed' : 'retrying']).toBe(1);
    }
    expect(await processDueSchedules(env.DB, clock + 180, async () => { calls++ })).toEqual({ published: 0, failed: 0, retrying: 0 });
    expect(calls).toBe(3);
    expect(await status(item.id)).toMatchObject({ status: 'failed', attempts: 3, publishAt: clock, error: 'Temporary storage error' });
  });
});
