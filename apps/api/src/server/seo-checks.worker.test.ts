/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import type { D1Migration } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { apiV1App } from './api/app';
import { hashApiToken } from './api-keys';
import { handleMcpRequest } from './mcp';
import { createPostOp, previewPostOp, publishPostOp, seoCheckPostOp } from './operations';
import type { OperationContext } from './operations';

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

const freeCtx: OperationContext = {
  siteId: 'seo-worker-free-site', workspaceId: 'seo-worker-free-workspace', tokenId: 'seo-worker-read-key',
  actor: { type: 'api_key', id: 'seo-worker-read-key', name: 'SEO writer', scopes: ['posts:read', 'posts:create', 'posts:update', 'posts:publish'] },
};
const otherCtx: OperationContext = { ...freeCtx, siteId: 'seo-worker-other-site', workspaceId: 'seo-worker-other-workspace' };
const tokens = {
  read: `vc_test_seo_read_${'a'.repeat(32)}`,
  write: `vc_test_seo_write_${'b'.repeat(32)}`,
};

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[]);
  for (const ctx of [freeCtx, otherCtx]) {
    await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
      .bind(ctx.workspaceId, ctx.workspaceId, ctx.workspaceId).run();
    await env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
      .bind(ctx.siteId, ctx.workspaceId, 'SEO site', ctx.siteId).run();
    await env.DB.prepare(`INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at)
      VALUES (?, ?, ?, 'default', 'active', 1, 1)`)
      .bind(`${ctx.siteId}-domain`, ctx.siteId, `${ctx.siteId}.example.com`).run();
  }
  await env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)')
    .bind('seo-worker-owner', 'SEO owner', 'seo-worker@example.com').run();
  for (const kind of ['read', 'write'] as const) {
    await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json,
      actor_name, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`)
      .bind(`seo-worker-${kind}-key`, freeCtx.siteId, kind, tokens[kind].slice(0, 18),
        await hashApiToken(tokens[kind], env.TOKEN_PEPPER), JSON.stringify(kind === 'read' ? ['posts:read'] : ['posts:update']),
        'SEO agent', 'seo-worker-owner').run();
  }
});

async function clearApiBudget() {
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(freeCtx.workspaceId).run();
}

async function resetFixtureState() {
  for (const ctx of [freeCtx, otherCtx]) {
    await env.DB.batch([
      // posts.published_version_id references post_versions (0018); clear it before deleting versions.
      env.DB.prepare('UPDATE posts SET published_version_id = NULL WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_preview_tokens WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_slug_redirects WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_schedules WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_versions WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM posts WHERE site_id = ?').bind(ctx.siteId),
    ]);
  }
  await clearApiBudget();
}

beforeEach(async () => {
  await resetFixtureState();
});

function createDraft(slug: string, ctx = freeCtx) {
  return createPostOp(ctx, { title: 'Reliable deployment practices', slug, contentMarkdown: '## Deployment\n\nDeploy safely.' });
}

async function listTools(token: string) {
  await clearApiBudget();
  const response = await handleMcpRequest(new Request('https://app.vibecms.dev/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { result: { tools: Array<{ name: string; annotations: Record<string, boolean>; _meta: Record<string, string> }> } };
  return body.result.tools;
}

async function restSeo(postId: string, token: string, query = '') {
  await clearApiBudget();
  return apiV1App.fetch(new Request(`https://app.vibecms.dev/api/v1/posts/${postId}/seo${query}`, {
    headers: { authorization: `Bearer ${token}` },
  }));
}

describe('saved-post SEO checks', () => {
  it('returns the same deterministic findings from preview and seo_check', async () => {
    const post = await createDraft('seo-preview');
    const preview = await previewPostOp(freeCtx, { postId: post.id });
    expect(preview.html).toContain('Deploy safely.');
    expect(preview.seo).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'description-missing', field: expect.any(String), fix: expect.any(String) }),
      expect.objectContaining({ code: 'content-thin' }),
    ]));
    const checked = await seoCheckPostOp(freeCtx, { postId: post.id });
    expect(checked).toEqual({ versionNumber: 1, findings: preview.seo });
  });

  it('skips metadata findings on markdown-only previews but runs them for saved posts', async () => {
    const words = 'word '.repeat(320).trim();
    const mdOnly = await previewPostOp(freeCtx, { contentMarkdown: words });
    const codes = mdOnly.seo.map((f) => f.code);
    expect(codes).not.toEqual(expect.arrayContaining([
      'title-length', 'description-missing', 'description-length', 'slug-long', 'slug-format',
      'social-image-default', 'duplicate-title', 'duplicate-description', 'canonical-external',
    ]));
    // Body and site checks still run.
    expect(codes).toContain('link-none-internal');
    const post = await createDraft('seo-saved-preview');
    const saved = await previewPostOp(freeCtx, { postId: post.id });
    expect(saved.seo.map((f) => f.code)).toContain('description-missing');
  });

  it('returns an empty seo list for content too nested to parse instead of failing the preview', async () => {
    const deep = '>'.repeat(5000) + ' Hi';
    const preview = await previewPostOp(freeCtx, { contentMarkdown: deep });
    expect(preview.seo).toEqual([]);
    expect(preview.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/nesting/i)]));
    expect(preview.html).toContain('<pre');
  });

  it('flags Unicode duplicate titles that SQLite lower() would miss', async () => {
    const published = await createPostOp(freeCtx, { title: 'Édition spéciale', slug: 'edition-speciale', contentMarkdown: '## Corps\n\nContenu.' });
    await publishPostOp(freeCtx, { postId: published.id, expectedVersionNumber: 1 });
    const draft = await createPostOp(freeCtx, { title: 'Édition spéciale', slug: 'edition-speciale-suite', contentMarkdown: '## Corps\n\nContenu.' });
    const checked = await seoCheckPostOp(freeCtx, { postId: draft.id });
    expect(checked.findings.map((f) => f.code)).toContain('duplicate-title');
  });

  it('never reports generated share-card and asset routes as broken internal links', async () => {
    const post = await createPostOp(freeCtx, {
      title: 'Reliable deployment practices',
      slug: 'seo-og-links',
      contentMarkdown: '![card](/og/other-post.png)\n\n[card](/og.png) [js](/_astro/app.js) [feed](/feed.xml)',
    });
    const checked = await seoCheckPostOp(freeCtx, { postId: post.id });
    expect(checked.findings.map((f) => f.code)).not.toContain('link-internal-broken');
  });

  it('requires posts:read, accepts a read-only actor and hides other tenants posts', async () => {
    const post = await createDraft('seo-scope');
    const readOnly: OperationContext = { ...freeCtx, actor: { ...freeCtx.actor, type: 'api_key', scopes: ['posts:read'] } };
    const writeOnly: OperationContext = { ...freeCtx, actor: { ...freeCtx.actor, type: 'api_key', scopes: ['posts:update'] } };
    await expect(seoCheckPostOp(readOnly, { postId: post.id })).resolves.toMatchObject({ versionNumber: 1 });
    await expect(seoCheckPostOp(writeOnly, { postId: post.id })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(seoCheckPostOp(otherCtx, { postId: post.id })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('lists the read-only SEO MCP tool only for keys with posts:read', async () => {
    expect((await listTools(tokens.read)).find((tool) => tool.name === 'posts.seo_check')).toMatchObject({
      annotations: { readOnlyHint: true }, _meta: { 'vibecms.com/requiredScope': 'posts:read' },
    });
    expect((await listTools(tokens.write)).find((tool) => tool.name === 'posts.seo_check')).toBeUndefined();
  });

  it('honors the REST focusKeyword query value with read scope enforcement', async () => {
    const post = await createDraft('seo-rest');
    const response = await restSeo(post.id, tokens.read, '?focusKeyword=quasar');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ versionNumber: 1, findings: expect.arrayContaining([
      expect.objectContaining({ code: 'keyword-title' }),
    ]) });
    const denied = await restSeo(post.id, tokens.write);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    const otherPost = await createDraft('seo-rest-other', otherCtx);
    const isolated = await restSeo(otherPost.id, tokens.read);
    expect(isolated.status).toBe(404);
    expect(await isolated.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
