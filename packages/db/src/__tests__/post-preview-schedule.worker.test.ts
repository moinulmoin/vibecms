/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

import { beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { createD1PostRepository, hashPreviewToken, putPreviewTokenRecord, resolvePreviewToken,
  claimDueSchedules, finishSchedule, schedulePost } from '@vc/db';
import { BillingRequiredError, ConflictError, publishScheduledPost, type Actor } from '@vc/core';

const SITE = 'preview-schedule-site';
const OTHER = 'preview-schedule-other';
const actor: Actor = { type: 'human', id: 'preview-user', name: 'Owner', role: 'owner' };
const scheduler: Actor = { type: 'system', id: 'system', name: 'System' };
const repo = createD1PostRepository(env.DB);
let sequence = 0;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[]);
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .bind('preview-schedule-ws', 'Owner', 'preview-schedule-ws').run();
  for (const site of [SITE, OTHER]) {
    await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
      .bind(site, 'preview-schedule-ws', site, site).run();
  }
});

async function create() {
  const id = `preview-post-${++sequence}`;
  return repo.createPostWithHistory({ id, siteId: SITE, title: 'Draft', slug: id,
    excerpt: null, contentMarkdown: 'Version one', coverAssetId: null, canonicalUrl: null,
    seoTitle: null, seoDescription: null, status: 'draft', publishedAt: null, tags: [], presentation: null },
  actor, { changeSummary: 'Created', activityAction: 'post.created', activitySummary: 'Created' });
}

async function leaseFor(postId: string, now = 1_800_000_000) {
  await schedulePost(env.DB, SITE, postId, 1, now, actor, now - 100);
  return (await claimDueSchedules(env.DB, now)).find((schedule) => schedule.postId === postId)!.leaseToken!;
}

describe('private preview tokens', () => {
  it('resolves only the current hash for the matching site; wrong and revoked tokens return null', async () => {
    const post = await create();
    const old = 'a'.repeat(64);
    const next = 'b'.repeat(64);
    expect(await putPreviewTokenRecord(env.DB, SITE, post.id, 'nonce-old', await hashPreviewToken(old), false)).toBe(true);
    expect(await resolvePreviewToken(env.DB, SITE, old)).toEqual({ postId: post.id });
    expect(await resolvePreviewToken(env.DB, OTHER, old)).toBeNull();
    expect(await resolvePreviewToken(env.DB, SITE, 'c'.repeat(64))).toBeNull();
    expect(await putPreviewTokenRecord(env.DB, SITE, post.id, 'nonce-new', await hashPreviewToken(next), true)).toBe(true);
    expect(await resolvePreviewToken(env.DB, SITE, old)).toBeNull();
    expect(await resolvePreviewToken(env.DB, SITE, next)).toEqual({ postId: post.id });
    const row = await env.DB.prepare('SELECT token_hash AS hash FROM post_preview_tokens WHERE post_id = ?').bind(post.id).first<{ hash: string }>();
    expect(row?.hash).not.toBe(next);
  });
});

describe('scheduled exact-version publishing', () => {
  it('claims only due schedules and pins v1 even when the tip moved to v2', async () => {
    const duePost = await create();
    const laterPost = await create();
    const now = 1_800_000_000;
    expect(await schedulePost(env.DB, SITE, duePost.id, 1, now - 1, actor, now - 100)).toBe(true);
    expect(await schedulePost(env.DB, SITE, laterPost.id, 1, now + 3600, actor, now - 100)).toBe(true);
    await repo.updatePostWithHistory(SITE, duePost.id, { contentMarkdown: 'Unseen v2', slug: `${duePost.slug}-later` }, actor,
      { changeSummary: 'Edited content', activityAction: 'post.updated', activitySummary: 'Edited' }, 1);
    expect((await repo.getPost(SITE, duePost.id))?.currentVersionNumber).toBe(2);
    const claimed = await claimDueSchedules(env.DB, now);
    expect(claimed.map((item) => item.postId)).toEqual([duePost.id]);
    const published = await publishScheduledPost(repo, scheduler, {
      siteId: SITE, postId: duePost.id, versionNumber: 1, billingStatus: 'active', scheduledBy: actor.name,
      leaseToken: claimed[0].leaseToken!,
    });
    await finishSchedule(env.DB, claimed[0], 'published', null, now);
    expect(published).toMatchObject({ currentVersionNumber: 2, publishedVersionNumber: 1, publishedSlug: duePost.slug });
    expect(published.slug).toBe(`${duePost.slug}-later`);
    expect((await repo.getPostVersion(SITE, duePost.id, 2))?.contentMarkdown).toBe('Unseen v2');
    const event = await env.DB.prepare("SELECT actor_type AS actorType, summary FROM activity_events WHERE entity_id = ? AND action = 'post.published'")
      .bind(duePost.id).first<{ actorType: string; summary: string }>();
    expect(event).toMatchObject({ actorType: 'system' });
    expect(event?.summary).toContain('Scheduled by Owner');
  });

  it('free-plan cap blocks the sixth scheduled publication', async () => {
    for (let index = 0; index < 4; index++) {
      const post = await create();
      const leaseToken = await leaseFor(post.id);
      await publishScheduledPost(repo, scheduler, {
        siteId: SITE, postId: post.id, versionNumber: 1, billingStatus: 'none', scheduledBy: actor.name, leaseToken,
      });
    }
    const sixth = await create();
    const leaseToken = await leaseFor(sixth.id);
    await expect(publishScheduledPost(repo, scheduler, {
      siteId: SITE, postId: sixth.id, versionNumber: 1, billingStatus: 'none', scheduledBy: actor.name, leaseToken,
    })).rejects.toBeInstanceOf(BillingRequiredError);
    expect((await repo.getPost(SITE, sixth.id))?.status).toBe('draft');
  });

  it('never folds a human autosave into a scheduled version', async () => {
    const post = await create();
    await repo.updatePostWithHistory(SITE, post.id, { contentMarkdown: 'Approved v2' }, actor,
      { changeSummary: 'Edited content', activityAction: 'post.updated', activitySummary: 'Edited' }, 1);
    await schedulePost(env.DB, SITE, post.id, 2, 1_900_000_000, actor, 1_800_000_000);
    const result = await repo.updatePostWithHistory(SITE, post.id, { contentMarkdown: 'Later v3' }, actor,
      { changeSummary: 'Edited content', activityAction: 'post.updated', activitySummary: 'Edited', coalesceVersion: true }, 2);
    expect(result?.versionNumber).toBe(3);
    expect((await repo.getPostVersion(SITE, post.id, 2))?.contentMarkdown).toBe('Approved v2');
  });

  it('keeps the approved row immutable when scheduling races an autosave batch', async () => {
    const post = await create();
    await repo.updatePostWithHistory(SITE, post.id, { contentMarkdown: 'Approved v2' }, actor,
      { changeSummary: 'Edited content', activityAction: 'post.updated', activitySummary: 'Edited' }, 1);
    let injected = false;
    const racing = createD1PostRepository(new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (!injected) {
            injected = true;
            await schedulePost(env.DB, SITE, post.id, 2, 1_900_000_000, actor, 1_800_000_000);
          }
          return target.batch(statements);
        };
        return Reflect.get(target, key);
      },
    }));
    const result = await racing.updatePostWithHistory(SITE, post.id, { contentMarkdown: 'New v3' }, actor,
      { changeSummary: 'Edited content', activityAction: 'post.updated', activitySummary: 'Edited', coalesceVersion: true }, 2);
    expect(result?.versionNumber).toBe(3);
    expect((await repo.getPostVersion(SITE, post.id, 2))?.contentMarkdown).toBe('Approved v2');
  });

  it('rejects a scheduled version whose slug conflicts with another post', async () => {
    const first = await create();
    const second = await create();
    await env.DB.prepare('UPDATE post_versions SET slug = ? WHERE post_id = ? AND version_number = 1')
      .bind(first.slug, second.id).run();
    const leaseToken = await leaseFor(second.id);
    await expect(publishScheduledPost(repo, scheduler, {
      siteId: SITE, postId: second.id, versionNumber: 1, billingStatus: 'active', scheduledBy: actor.name, leaseToken,
    })).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not revive a post archived after it was scheduled', async () => {
    const post = await create();
    await schedulePost(env.DB, SITE, post.id, 1, 1_900_000_000, actor, 1_800_000_000);
    const leaseToken = (await claimDueSchedules(env.DB, 1_900_000_000)).find((schedule) => schedule.postId === post.id)!.leaseToken!;
    await repo.updatePostWithHistory(SITE, post.id, { status: 'archived' }, actor,
      { changeSummary: 'Archived', activityAction: 'post.archived', activitySummary: 'Archived' }, 1);
    expect((await claimDueSchedules(env.DB, 1_900_000_000)).some((schedule) => schedule.postId === post.id)).toBe(false);
    await expect(publishScheduledPost(repo, scheduler, {
      siteId: SITE, postId: post.id, versionNumber: 1, billingStatus: 'active', scheduledBy: actor.name, leaseToken,
    })).rejects.toThrow('Post is archived; publication was not performed.');
  });

  it('fences a worker after its lease expires and another worker reclaims', async () => {
    const post = await create();
    const clock = 2_000_000_000;
    await schedulePost(env.DB, SITE, post.id, 1, clock, actor, clock - 1);
    const first = (await claimDueSchedules(env.DB, clock)).find((entry) => entry.postId === post.id)!;
    const second = (await claimDueSchedules(env.DB, clock + 121)).find((entry) => entry.postId === post.id)!;
    expect(first.leaseToken).not.toBe(second.leaseToken);
    const input = { siteId: SITE, postId: post.id, versionNumber: 1, billingStatus: 'active' as const, scheduledBy: actor.name };
    await publishScheduledPost(repo, scheduler, { ...input, leaseToken: second.leaseToken! });
    await finishSchedule(env.DB, second, 'published', null, clock + 121);
    await repo.updatePostWithHistory(SITE, post.id, { contentMarkdown: 'New v2' }, actor,
      { changeSummary: 'Edited', activityAction: 'post.updated', activitySummary: 'Edited' }, 1);
    await repo.publishPostWithHistory(SITE, post.id, 2, actor,
      { changeSummary: 'Published', activityAction: 'post.published', activitySummary: 'Published' },
      { billingActive: true, freeLimit: 5 });
    await expect(publishScheduledPost(repo, scheduler, { ...input, leaseToken: first.leaseToken! }))
      .rejects.toThrow('Schedule lease expired');
    expect(await finishSchedule(env.DB, first, 'published', null, clock + 122)).toBe(false);
    expect((await repo.getPost(SITE, post.id))?.publishedVersionNumber).toBe(2);
  });

  it('does not publish when archive lands between the read and publish batch', async () => {
    const post = await create();
    const leaseToken = await leaseFor(post.id, 2_100_000_000);
    let archived = false;
    const racing = createD1PostRepository(new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (!archived) {
            archived = true;
            await repo.updatePostWithHistory(SITE, post.id, { status: 'archived' }, actor,
              { changeSummary: 'Archived', activityAction: 'post.archived', activitySummary: 'Archived' }, 1);
          }
          return target.batch(statements);
        };
        return Reflect.get(target, key);
      },
    }));
    await expect(publishScheduledPost(racing, scheduler, {
      siteId: SITE, postId: post.id, versionNumber: 1, billingStatus: 'active', scheduledBy: actor.name, leaseToken,
    })).rejects.toThrow('Post is archived; publication was not performed.');
    expect((await repo.getPost(SITE, post.id))?.status).toBe('archived');
  });
});
