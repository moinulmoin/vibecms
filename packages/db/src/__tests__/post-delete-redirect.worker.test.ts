/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext { migrations: D1Migration[] }
}

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { ConflictError, type Actor } from "@vc/core";
import { createD1PostRepository, getPublishedSlugRedirect } from "@vc/db";

const siteId = "delete-redirect-site";
const actor: Actor = { type: "human", id: "delete-redirect-user", name: "Editor", role: "editor" };
const repo = createD1PostRepository(env.DB);
let sequence = 0;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('delete-redirect-ws', 'Site', 'delete-redirect-ws', 1, 1)").run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, 'delete-redirect-ws', 'Site', ?, 1, 1)")
    .bind(siteId, siteId).run();
});

async function create(slug: string, coverAssetId: string | null = null) {
  return repo.createPostWithHistory({ id: `post-${++sequence}`, siteId, title: `Title ${slug}`, slug,
    excerpt: null, contentMarkdown: `![cover](/media-assets/${coverAssetId})`, coverAssetId,
    canonicalUrl: null, seoTitle: null, seoDescription: null, status: "draft", publishedAt: null,
    tags: [], presentation: null }, actor,
  { changeSummary: "Created", activityAction: "post.created", activitySummary: "Created" });
}

async function publish(postId: string, version: number) {
  return repo.publishPostWithHistory(siteId, postId, version, actor,
    { changeSummary: "Published", activityAction: "post.published", activitySummary: "Published" },
    { billingActive: true, freeLimit: 5 });
}

async function rename(postId: string, slug: string, version: number) {
  return repo.updatePostWithHistory(siteId, postId, { slug }, actor,
    { changeSummary: "Edited slug", activityAction: "post.updated", activitySummary: "Edited slug" }, version);
}

describe("post deletion and live slug redirects", () => {
  it("rejects non-archived posts, then removes versions and history but keeps the asset", async () => {
    const assetId = `asset-${++sequence}`;
    await env.DB.prepare(`INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes,
      created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, 'cover.png', 'image/png', 1, 'human', ?, 1, 1)`)
      .bind(assetId, siteId, assetId, actor.id).run();
    const post = await create(`delete-${sequence}`, assetId);
    await expect(repo.deleteArchivedPost(siteId, post.id, actor)).rejects.toBeInstanceOf(ConflictError);
    expect(await repo.getPost(siteId, post.id)).not.toBeNull();
    await repo.updatePostWithHistory(siteId, post.id, { status: "archived" }, actor,
      { changeSummary: "Archived", activityAction: "post.archived", activitySummary: "Archived" }, 1);
    await repo.deleteArchivedPost(siteId, post.id, actor);
    expect(await repo.getPost(siteId, post.id)).toBeNull();
    expect((await env.DB.prepare("SELECT count(*) AS n FROM post_versions WHERE post_id = ?").bind(post.id).first<{ n: number }>())?.n).toBe(0);
    // History survives (who did what), but no copy of the writing does.
    const actions = await env.DB.prepare("SELECT action, summary, before_json, after_json FROM activity_events WHERE site_id = ? AND entity_type = 'post' AND entity_id = ? ORDER BY created_at, action")
      .bind(siteId, post.id).all<{ action: string; summary: string; before_json: string | null; after_json: string | null }>();
    expect(actions.results.map((row) => row.action)).toContain("post.archived");
    expect(actions.results.at(-1)).toMatchObject({ action: "post.deleted", summary: `Deleted ${post.title}` });
    expect(actions.results.every((row) => row.before_json === null && row.after_json === null)).toBe(true);
    expect(await env.DB.prepare("SELECT id FROM assets WHERE id = ?").bind(assetId).first()).not.toBeNull();
  });

  it("records live moves, removes a reused redirect, hides archived targets, and cascades on delete", async () => {
    const post = await create(`old-${++sequence}`);
    await publish(post.id, 1);
    await rename(post.id, `new-${sequence}`, 1);
    await publish(post.id, 2);
    expect(await getPublishedSlugRedirect(env.DB, siteId, post.slug)).toBe(`new-${sequence}`);
    expect(await repo.listPostRedirects(siteId, post.id)).toEqual([post.slug]);
    await rename(post.id, post.slug, 2);
    await publish(post.id, 3);
    expect(await getPublishedSlugRedirect(env.DB, siteId, post.slug)).toBeNull();
    expect(await repo.listPostRedirects(siteId, post.id)).toEqual([`new-${sequence}`]);
    await repo.updatePostWithHistory(siteId, post.id, { status: "archived" }, actor,
      { changeSummary: "Archived", activityAction: "post.archived", activitySummary: "Archived" }, 3);
    expect(await getPublishedSlugRedirect(env.DB, siteId, `new-${sequence}`)).toBeNull();
    await repo.deleteArchivedPost(siteId, post.id, actor);
    expect(await repo.listPostRedirects(siteId, post.id)).toEqual([]);
  });

  it("lets another post deliberately reuse a redirected slug and removes the redirect on publish", async () => {
    const original = await create(`reused-${++sequence}`);
    await publish(original.id, 1);
    const movedSlug = `moved-${sequence}`;
    await rename(original.id, movedSlug, 1);
    await publish(original.id, 2);
    const replacement = await create(original.slug);
    expect(await getPublishedSlugRedirect(env.DB, siteId, original.slug)).toBe(movedSlug);
    await publish(replacement.id, 1);
    expect(await getPublishedSlugRedirect(env.DB, siteId, original.slug)).toBeNull();
    expect(await repo.listPostRedirects(siteId, original.id)).toEqual([]);
  });
});
