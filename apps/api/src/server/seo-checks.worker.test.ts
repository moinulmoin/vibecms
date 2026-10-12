/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import type { D1Migration } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { apiV1App } from './api/app';
import { hashApiToken } from './api-keys';
import { handleMcpRequest } from './mcp';
import { createPostOp, previewPostOp, publishPostOp, seoCheckPostOp, updatePostOp } from './operations';
import type { OperationContext } from './operations';

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

const freeCtx: OperationContext = {
  siteId: 'seo-worker-free-site', workspaceId: 'seo-worker-free-workspace', tokenId: 'seo-worker-read-key',
  actor: { type: 'api_key', id: 'seo-worker-read-key', name: 'SEO writer', scopes: ['posts:read', 'posts:create', 'posts:update', 'posts:publish'] },
};
const paidCtx: OperationContext = { ...freeCtx, siteId: 'seo-worker-paid-site', workspaceId: 'seo-worker-paid-workspace' };
const otherCtx: OperationContext = { ...freeCtx, siteId: 'seo-worker-other-site', workspaceId: 'seo-worker-other-workspace' };
const tokens = {
  read: `vc_test_seo_read_${'a'.repeat(32)}`,
  write: `vc_test_seo_write_${'b'.repeat(32)}`,
};
const review = {
  intent: 'Explain reliable deployment practices.',
  titleIdeas: ['Reliable deployment practices', 'How to deploy with confidence'],
  descriptionIdea: 'Learn how reliable deployment practices reduce risk with clear release checks and recovery procedures.',
  missingSubtopics: ['Rollback procedures'],
  unclearPassages: [{ quote: 'Deploy safely.', why: 'Explain which checks make deployment safe.' }],
  claimsNeedingSources: [{ quote: 'This prevents every outage.' }],
};
const mutableEnv = env as unknown as Record<string, unknown>;
const savedEnv = { AI: mutableEnv.AI, SELF_HOSTED: mutableEnv.SELF_HOSTED, SEO_REVIEW_MODEL: mutableEnv.SEO_REVIEW_MODEL };
const run = vi.fn(async (_model: string, _input: unknown): Promise<unknown> => ({ response: JSON.stringify(review) }));

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[]);
  for (const ctx of [freeCtx, paidCtx, otherCtx]) {
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
  await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json,
    actor_name, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, 1, 1)`)
    .bind('seo-worker-paid-key', paidCtx.siteId, 'Managed key', 'seo-paid', 'seo-paid-hash', 'Managed agent', 'seo-worker-owner').run();
  await env.DB.prepare(`INSERT INTO autoseopilot_managed_sites (id, external_workspace_id, owner_user_id, workspace_id,
    site_id, credential_id, credential_generation, api_key_id, entitlement_status, lifecycle_revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', 1, 1, 1)`)
    .bind('seo-worker-managed', 'seo-worker-external', 'seo-worker-owner', paidCtx.workspaceId,
      paidCtx.siteId, 'seo-worker-credential', 'seo-worker-paid-key').run();
});

async function clearApiBudget() {
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(freeCtx.workspaceId).run();
}

async function resetFixtureState() {
  for (const ctx of [freeCtx, paidCtx, otherCtx]) {
    await env.DB.batch([
      // posts.published_version_id references post_versions (0018); clear it before deleting versions.
      env.DB.prepare('UPDATE posts SET published_version_id = NULL WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_seo_reviews WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_preview_tokens WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_slug_redirects WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_schedules WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM post_versions WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare('DELETE FROM posts WHERE site_id = ?').bind(ctx.siteId),
      env.DB.prepare("DELETE FROM rate_limits WHERE id LIKE 'seo-review:' || ? || ':%'").bind(ctx.siteId),
    ]);
  }
  await clearApiBudget();
}

beforeEach(async () => {
  await resetFixtureState();
  run.mockReset().mockResolvedValue({ response: JSON.stringify(review) });
  mutableEnv.AI = { run };
  mutableEnv.SELF_HOSTED = 'false';
  mutableEnv.SEO_REVIEW_MODEL = '@cf/google/gemma-4-26b-a4b-it';
});

afterEach(() => {
  for (const key of ['AI', 'SELF_HOSTED', 'SEO_REVIEW_MODEL'] as const) {
    if (savedEnv[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
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

async function seedDailyReviews(ctx: OperationContext, count: number, now: number) {
  const today = Math.floor(now / 86400) * 86400;
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  await env.DB.prepare('INSERT INTO rate_limits (id, count, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(`seo-review:${ctx.siteId}:${day}`, count, today + 86400, now, now).run();
}

describe('saved-post SEO checks', () => {
  it('includes deterministic findings on preview without calling AI', async () => {
    const post = await createDraft('seo-preview');
    const preview = await previewPostOp(freeCtx, { postId: post.id });
    expect(preview.html).toContain('Deploy safely.');
    expect(preview.seo).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'description-missing', field: expect.any(String), fix: expect.any(String) }),
      expect.objectContaining({ code: 'content-thin' }),
    ]));
    const checked = await seoCheckPostOp(freeCtx, { postId: post.id });
    expect(checked.versionNumber).toBe(1);
    expect(checked.findings).toEqual(preview.seo);
    expect(checked).not.toHaveProperty('ai');
    expect(run).not.toHaveBeenCalled();
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
    await expect(seoCheckPostOp(writeOnly, { postId: post.id, ai: true })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(seoCheckPostOp(otherCtx, { postId: post.id, ai: true })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(run).not.toHaveBeenCalled();
  });

  it('lists the read-only SEO MCP tool only for keys with posts:read', async () => {
    expect((await listTools(tokens.read)).find((tool) => tool.name === 'posts.seo_check')).toMatchObject({
      annotations: { readOnlyHint: true }, _meta: { 'vibecms.com/requiredScope': 'posts:read' },
    });
    expect((await listTools(tokens.write)).find((tool) => tool.name === 'posts.seo_check')).toBeUndefined();
  });

  it('honors REST focusKeyword and ai=1 query values with read scope enforcement', async () => {
    const post = await createDraft('seo-rest');
    const response = await restSeo(post.id, tokens.read, '?focusKeyword=quasar');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ versionNumber: 1, findings: expect.arrayContaining([
      expect.objectContaining({ code: 'keyword-title' }),
    ]) });
    expect(run).not.toHaveBeenCalled();
    const disabled = await restSeo(post.id, tokens.read, '?ai=0');
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).not.toHaveProperty('ai');
    expect(run).not.toHaveBeenCalled();
    const aiResponse = await restSeo(post.id, tokens.read, '?ai=1&focusKeyword=deployment');
    expect(aiResponse.status).toBe(200);
    expect(await aiResponse.json()).toMatchObject({ versionNumber: 1, ai: review });
    expect(run).toHaveBeenCalledTimes(1);
    const denied = await restSeo(post.id, tokens.write, '?ai=1');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(run).toHaveBeenCalledTimes(1);
    const otherPost = await createDraft('seo-rest-other', otherCtx);
    const isolated = await restSeo(otherPost.id, tokens.read, '?ai=1');
    expect(isolated.status).toBe(404);
    expect(await isolated.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns validated AI output and reuses the same-version cache even when the keyword changes', async () => {
    const post = await createDraft('seo-ai-cache');
    const first = await seoCheckPostOp(freeCtx, { postId: post.id, focusKeyword: 'deployment', ai: true });
    expect(first).toMatchObject({ versionNumber: 1, ai: review });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    const cached = await seoCheckPostOp(freeCtx, { postId: post.id, focusKeyword: 'quasar', ai: true });
    expect(cached.ai).toEqual(review);
    expect(cached.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'keyword-title' })]));
    expect(run).toHaveBeenCalledTimes(1);
    await updatePostOp(freeCtx, { postId: post.id, expectedVersionNumber: 1, contentMarkdown: '## Deployment\n\nCheck the release and recovery procedure.' });
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({ versionNumber: 2, ai: review });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('parses and caches the documented Workers AI chat envelope', async () => {
    const post = await createDraft('seo-ai-chat-envelope');
    run.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(review) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
    const first = await seoCheckPostOp(freeCtx, { postId: post.id, ai: true });
    expect(first).toMatchObject({ versionNumber: 1, ai: review });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      max_completion_tokens: 700,
      chat_template_kwargs: { enable_thinking: false },
      response_format: { type: 'json_schema' },
    });
    const cached = await seoCheckPostOp(freeCtx, { postId: post.id, ai: true });
    expect(cached.ai).toEqual(review);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('trims over-long model lists to the contract instead of discarding the review', async () => {
    const post = await createDraft('seo-ai-overlong');
    run.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...review, titleIdeas: ['One', 'Two', 'Three'] }) } }],
      usage: { prompt_tokens: 62, completion_tokens: 93, neurons: 3.1 },
    });
    const result = await seoCheckPostOp(freeCtx, { postId: post.id, ai: true });
    expect(result.ai?.titleIdeas).toEqual(['One', 'Two']);
    expect(result.warnings ?? []).not.toContain('AI SEO review did not return a valid review; using deterministic checks only.');
  });

  it('keeps deterministic findings and returns ai:null with a warning for invalid model JSON', async () => {
    const post = await createDraft('seo-ai-invalid');
    run.mockResolvedValueOnce({ response: 'not JSON' });
    const result = await seoCheckPostOp(freeCtx, { postId: post.id, ai: true });
    expect(result.ai).toBeNull();
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'content-thin' })]));
    expect(result.warnings).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects structurally invalid model output rather than returning unvalidated review fields', async () => {
    const post = await createDraft('seo-ai-invalid-shape');
    run.mockResolvedValueOnce({ response: JSON.stringify({ ...review, titleIdeas: ['Only one title'] }) });
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({
      ai: null, warnings: expect.arrayContaining([expect.any(String)]),
    });
    run.mockResolvedValueOnce({ response: JSON.stringify({ ...review, unexpectedField: 'Not in the strict schema' }) });
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({
      ai: null, warnings: expect.arrayContaining([expect.any(String)]),
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached review from a different model', async () => {
    const post = await createDraft('seo-ai-model-cache');
    await seoCheckPostOp(freeCtx, { postId: post.id, ai: true });
    mutableEnv.SEO_REVIEW_MODEL = '@cf/test/another-seo-model';
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({ ai: review });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]).toBe('@cf/test/another-seo-model');
    mutableEnv.SEO_REVIEW_MODEL = '@cf/google/gemma-4-26b-a4b-it';
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({ ai: review });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('limits free hosted sites to three reviews per UTC day, permits cached results at the limit and resets at midnight', async () => {
    const now = Date.parse('2026-10-12T12:34:56Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const today = Math.floor(now / 1000 / 86400) * 86400;
    const post = await createDraft('seo-free-limit');
    await seedDailyReviews(freeCtx, 2, Math.floor(now / 1000));
    await seedDailyReviews(freeCtx, 100, today - 1);
    await seedDailyReviews(otherCtx, 100, Math.floor(now / 1000));
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({ ai: review });
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true, focusKeyword: 'new keyword' })).toMatchObject({ ai: review });
    expect(run).toHaveBeenCalledTimes(1);
    await updatePostOp(freeCtx, { postId: post.id, expectedVersionNumber: 1, title: 'A changed deployment guide' });
    await expect(seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).rejects.toMatchObject({
      code: 'RATE_LIMIT', status: 429, retryAfterSeconds: today + 86400 - Math.floor(now / 1000),
    });
    expect(run).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue((today + 86400) * 1000);
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({ versionNumber: 2, ai: review });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives effective managed paid sites 100 daily reviews without a Polar subscription', async () => {
    const now = Date.parse('2026-10-12T12:34:56Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const today = Math.floor(now / 1000 / 86400) * 86400;
    const post = await createDraft('seo-paid-limit', paidCtx);
    await seedDailyReviews(paidCtx, 99, Math.floor(now / 1000));
    expect(await seoCheckPostOp(paidCtx, { postId: post.id, ai: true })).toMatchObject({ ai: review });
    expect(await seoCheckPostOp(paidCtx, { postId: post.id, ai: true })).toMatchObject({ ai: review });
    expect(run).toHaveBeenCalledTimes(1);
    await updatePostOp(paidCtx, { postId: post.id, expectedVersionNumber: 1, title: 'Paid deployment guide update' });
    await expect(seoCheckPostOp(paidCtx, { postId: post.id, ai: true })).rejects.toMatchObject({
      code: 'RATE_LIMIT', status: 429, retryAfterSeconds: today + 86400 - Math.floor(now / 1000),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not impose hosted review limits on self-hosters', async () => {
    mutableEnv.SELF_HOSTED = 'true';
    const post = await createDraft('seo-self-host-limit');
    await seedDailyReviews(freeCtx, 101, Math.floor(Date.now() / 1000));
    expect(await seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).toMatchObject({ versionNumber: 1, ai: review });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing AI binding only when an AI review is requested', async () => {
    const post = await createDraft('seo-ai-unavailable');
    mutableEnv.SELF_HOSTED = 'true';
    delete mutableEnv.AI;
    await expect(seoCheckPostOp(freeCtx, { postId: post.id })).resolves.toMatchObject({ versionNumber: 1 });
    await expect(seoCheckPostOp(freeCtx, { postId: post.id, ai: true })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', status: 503 });
    expect(run).not.toHaveBeenCalled();
  });
});
