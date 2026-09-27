/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

import { beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { createD1PostRepository, hashPreviewToken, putPreviewTokenRecord, resolvePreviewToken } from '@vc/db';
import { loadPrivatePreview, previewNotFound, previewResponseHeaders } from './preview';
import { parsePublicRuntimeEnv } from './public-url';

const siteId = 'private-preview-site';
const host = `${siteId}.basedui.dev`;
const repo = createD1PostRepository(env.DB);

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[]);
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .bind('private-preview-workspace', 'Preview', 'private-preview-workspace').run();
  await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
    .bind(siteId, 'private-preview-workspace', 'Preview', siteId).run();
  await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'default', 'active', 1, 1)")
    .bind('private-preview-domain', siteId, host).run();
});

describe('private preview responses', () => {
  it('send noindex and no-store on both success and not-found paths', () => {
    const headers = new Headers(previewResponseHeaders);
    expect(headers.get('X-Robots-Tag')).toContain('noindex');
    expect(headers.get('Cache-Control')).toContain('no-store');
    const missing = previewNotFound();
    expect(missing.status).toBe(404);
    expect(missing.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(missing.headers.get('Cache-Control')).toContain('no-store');
  });

  it('returns 404 while archived and reuses the same token after restore', async () => {
    const actor = { type: 'human' as const, id: 'preview-owner', name: 'Owner', role: 'owner' as const };
    const post = await repo.createPostWithHistory({ id: 'private-preview-post', siteId, title: 'Private', slug: 'private',
      excerpt: null, contentMarkdown: 'Private draft', coverAssetId: null, canonicalUrl: null,
      seoTitle: null, seoDescription: null, status: 'draft', publishedAt: null, tags: [], presentation: null },
    actor, { changeSummary: 'Created', activityAction: 'post.created', activitySummary: 'Created' });
    const token = 'a'.repeat(64);
    await putPreviewTokenRecord(env.DB, siteId, post.id, 'preview-nonce', await hashPreviewToken(token), false);
    const request = new Request(`https://${host}/preview/${token}`);
    const runtime = { ...parsePublicRuntimeEnv(env), selfHosted: true };
    expect(await loadPrivatePreview(env.DB, request, token, runtime)).not.toBeNull();
    await repo.updatePostWithHistory(siteId, post.id, { status: 'archived' }, actor,
      { changeSummary: 'Archived', activityAction: 'post.archived', activitySummary: 'Archived' }, 1);
    expect(await loadPrivatePreview(env.DB, request, token, runtime)).toBeNull();
    expect(previewNotFound().status).toBe(404);
    expect(await resolvePreviewToken(env.DB, siteId, token)).toBeNull();
    await repo.updatePostWithHistory(siteId, post.id, { status: 'draft' }, actor,
      { changeSummary: 'Restored', activityAction: 'post.unarchived', activitySummary: 'Restored' }, 2);
    expect(await resolvePreviewToken(env.DB, siteId, token)).toEqual({ postId: post.id });
    expect(await loadPrivatePreview(env.DB, request, token, runtime)).not.toBeNull();
  });
});

describe("preview routing", () => {
  it("has a real page route (Astro ignores _-prefixed folders)", () => {
    const pages = Object.keys(import.meta.glob("../pages/**/*.astro"));
    expect(pages).toContain("../pages/preview/[token].astro");
    expect(pages.filter((path) => /\/pages\/(?:.*\/)?_/.test(path))).toEqual([]);
  });
});
