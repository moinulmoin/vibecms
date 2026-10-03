/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { claimDueSchedules, resolvePreviewToken } from '@vc/db';
import { createPostOp, previewPostOp, publishPostOp, rotatePostPreviewOp, schedulePostOp, unschedulePostOp, updatePostOp, type OperationContext } from './operations';

const race = vi.hoisted(() => ({ beforeDelete: null as null | (() => Promise<void>) }));
vi.mock('@vc/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@vc/db')>();
  return { ...original, unschedulePost: async (...args: Parameters<typeof original.unschedulePost>) => {
    if (race.beforeDelete) await race.beforeDelete();
    return original.unschedulePost(...args);
  } };
});

const siteId = 'api-preview-regression-site';
const ctx: OperationContext = {
  siteId, workspaceId: 'api-preview-regression-ws', tokenId: 'preview-key',
  actor: { type: 'api_key', id: 'preview-key', name: 'Writer',
    scopes: ['posts:read', 'posts:create', 'posts:update'] },
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[]);
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .bind(ctx.workspaceId, 'Preview', ctx.workspaceId).run();
  await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
    .bind(siteId, ctx.workspaceId, 'Preview', siteId).run();
  await env.DB.prepare(`INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at)
    VALUES (?, ?, ?, 'default', 'active', 1, 1)`)
    .bind('api-preview-regression-domain', siteId, `${siteId}.example.com`).run();
});

describe('agent saved-post preview URL', () => {
  it('returns one latest-tip link on create, update and preview, then revokes it on rotation', async () => {
    const created = await createPostOp(ctx, { title: 'Draft', slug: 'api-preview-draft', contentMarkdown: 'First body' });
    expect(created.previewUrl).toMatch(/^https:\/\/[^/]+\/preview\/[a-f0-9]{64}$/);
    const updated = await updatePostOp(ctx, { postId: created.id, expectedVersionNumber: 1, contentMarkdown: 'Second body' });
    expect(updated.previewUrl).toBe(created.previewUrl);
    const rendered = await previewPostOp(ctx, { postId: created.id });
    expect(rendered.previewUrl).toBe(created.previewUrl);
    expect(rendered.html).toContain('Second body');
    const publisher: OperationContext = { ...ctx, actor: {
      type: 'api_key', id: 'publisher-key', name: 'Publisher', scopes: ['posts:publish'],
    } };
    await publishPostOp(publisher, { postId: created.id, expectedVersionNumber: 2 });
    const changed = await updatePostOp(ctx, { postId: created.id, expectedVersionNumber: 2, contentMarkdown: 'Pending change' });
    expect(changed.publishedVersionNumber).toBe(2);
    expect(changed.previewUrl).toBe(created.previewUrl);
    expect((await previewPostOp(ctx, { postId: created.id })).html).toContain('Pending change');
    const oldToken = created.previewUrl!.split('/').at(-1)!;
    expect(await resolvePreviewToken(env.DB, siteId, oldToken)).toEqual({ postId: created.id });
    const rotated = await rotatePostPreviewOp(ctx, { postId: created.id });
    expect(rotated.previewUrl).not.toBe(created.previewUrl);
    expect(await resolvePreviewToken(env.DB, siteId, oldToken)).toBeNull();
    expect(await resolvePreviewToken(env.DB, siteId, rotated.previewUrl!.split('/').at(-1)!)).toEqual({ postId: created.id });
  });

  it('allows scheduling with posts:publish alone and returns the pending status', async () => {
    const created = await createPostOp(ctx, { title: 'For Tuesday', slug: 'api-preview-schedule', contentMarkdown: 'Approved' });
    const publisher: OperationContext = { ...ctx, actor: {
      type: 'api_key', id: 'publisher-key', name: 'Publisher', scopes: ['posts:publish'],
    } };
    const publishAt = Math.floor(Date.now() / 1000) + 3600;
    const scheduled = await schedulePostOp(publisher, { postId: created.id, versionNumber: 1, publishAt });
    expect(scheduled.scheduledPublish).toMatchObject({ versionNumber: 1, publishAt, status: 'pending' });
    const canceled = await unschedulePostOp(publisher, { postId: created.id });
    expect(canceled.scheduledPublish).toBeNull();
  });

  it('reports Already publishing when a claim wins before unschedule', async () => {
    const created = await createPostOp(ctx, { title: 'Race', slug: 'api-unschedule-race', contentMarkdown: 'Approved' });
    const publisher: OperationContext = { ...ctx, actor: {
      type: 'api_key', id: 'publisher-key', name: 'Publisher', scopes: ['posts:publish'],
    } };
    const now = Math.floor(Date.now() / 1000);
    await schedulePostOp(publisher, { postId: created.id, versionNumber: 1, publishAt: now + 1 });
    const clock = now + 1;
    race.beforeDelete = async () => { await claimDueSchedules(env.DB, clock); };
    try {
      await expect(unschedulePostOp(publisher, { postId: created.id }))
        .rejects.toMatchObject({ status: 409, message: 'Already publishing' });
    } finally {
      race.beforeDelete = null;
    }
  });
});
