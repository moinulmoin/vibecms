/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext { migrations: D1Migration[] }
}

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { ConflictError, type Actor } from "@vc/core";
import { createD1AssetRepository, createD1PostRepository, createPendingMediaRepository } from "@vc/db";

const siteId = "review-regressions-site";
const actor: Actor = { type: "human", id: "review-regressions-user", name: "Reviewer", role: "owner" };
const history = { changeSummary: "Edited content", activityAction: "post.updated", activitySummary: "Edited content" };
let sequence = 0;
const repo = createD1PostRepository(env.DB);

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .bind("review-regressions-ws", "Reviewer", "review-regressions-ws").run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)")
    .bind(siteId, "review-regressions-ws", "Reviewer", siteId).run();
});

async function create(slug?: string, coverAssetId: string | null = null) {
  const id = `review-post-${++sequence}`;
  return repo.createPostWithHistory({ id, siteId, title: id, slug: slug ?? id,
    excerpt: null, contentMarkdown: "Original", coverAssetId, canonicalUrl: null,
    seoTitle: null, seoDescription: null, status: "draft", publishedAt: null,
    tags: [], presentation: null }, actor,
  { changeSummary: "Created", activityAction: "post.created", activitySummary: "Created" });
}

async function publish(id: string, version = 1) {
  return repo.publishPostWithHistory(siteId, id, version, actor,
    { changeSummary: "Published", activityAction: "post.published", activitySummary: "Published" },
    { billingActive: true, freeLimit: 5 });
}

describe("post review regressions", () => {
  it("reads content and both version numbers in one statement for both lookups", async () => {
    const post = await create();
    const versionCount = await env.DB.prepare("SELECT count(*) AS n FROM post_versions WHERE post_id = ?").bind(post.id).first<{ n: number }>();
    expect(versionCount?.n).toBe(1);
    let reads = 0;
    const counted = createD1PostRepository(new Proxy(env.DB, {
      get(target, key) {
        if (key === "prepare") return (query: string) => { reads++; return target.prepare(query); };
        return Reflect.get(target, key);
      },
    }));
    expect(await counted.getPost(siteId, post.id)).toMatchObject({ contentMarkdown: "Original", currentVersionNumber: 1 });
    expect(reads).toBe(1);
    reads = 0;
    expect(await counted.findPostBySlug(siteId, post.slug)).toMatchObject({ contentMarkdown: "Original", currentVersionNumber: 1 });
    expect(reads).toBe(1);
  });

  it("keeps a concurrent publish live during a content save", async () => {
    const post = await create();
    let injected = false;
    const racing = createD1PostRepository(new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          if (!injected) { injected = true; await publish(post.id); }
          return target.batch(statements);
        };
        return Reflect.get(target, key);
      },
    }));
    await racing.updatePostWithHistory(siteId, post.id, { contentMarkdown: "New draft" }, actor, history, 1);
    expect(await repo.getPost(siteId, post.id)).toMatchObject({ status: "published", contentMarkdown: "New draft", publishedVersionNumber: 1 });
  });

  it("rejects a lifecycle edit when publication changes after its read", async () => {
    const post = await create();
    let injected = false;
    const racing = createD1PostRepository(new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          if (!injected) { injected = true; await publish(post.id); }
          return target.batch(statements);
        };
        return Reflect.get(target, key);
      },
    }));
    await expect(racing.updatePostWithHistory(siteId, post.id, { status: "archived" }, actor, history, 1))
      .rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getPost(siteId, post.id))?.status).toBe("published");
  });

  it("reserves a live pinned slug after its draft is renamed, including at publish", async () => {
    const first = await create();
    await publish(first.id);
    await repo.updatePostWithHistory(siteId, first.id, { slug: `${first.slug}-new` }, actor, history, 1);
    await expect(create(first.slug)).rejects.toBeInstanceOf(ConflictError);
    const second = await create();
    await env.DB.prepare("UPDATE post_versions SET slug = ? WHERE post_id = ?").bind(first.slug, second.id).run();
    await expect(publish(second.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getPost(siteId, second.id))?.status).toBe("draft");
  });

  it("keeps historical covers and inline images for restoration and guards deletion atomically", async () => {
    const id = `review-asset-${++sequence}`;
    await env.DB.prepare(`INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes,
      created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, 'a.png', 'image/png', 1, 'human', ?, 1, 1)`)
      .bind(id, siteId, `${siteId}/${id}`, actor.id).run();
    const post = await create(undefined, id);
    await publish(post.id);
    await repo.updatePostWithHistory(siteId, post.id, { coverAssetId: null }, actor, history, 1);
    const assets = createD1AssetRepository(env.DB);
    expect(await assets.isAssetReferencedAsCover(siteId, id)).toBe(true);
    await expect(assets.updateAssetAltText(siteId, id, null)).rejects.toBeInstanceOf(ConflictError);
    const pending = createPendingMediaRepository(env.DB);
    await expect(pending.deleteAssetWithPendingOp({ opId: `${id}-op`, siteId, assetId: id,
      storageKey: `${siteId}/${id}`, sizeBytes: 1, activity: { siteId, actor, action: "asset.deleted", entityType: "asset", entityId: id, summary: "Deleted" } }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(await assets.getAsset(siteId, id)).not.toBeNull();
    expect(await pending.getOp(`${id}-op`)).toBeNull();
  });

  it("keeps an inline image referenced by a saved version", async () => {
    const id = `review-inline-${++sequence}`;
    await env.DB.prepare(`INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes,
      created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, 'inline.png', 'image/png', 1, 'human', ?, 1, 1)`)
      .bind(id, siteId, `${siteId}/${id}`, actor.id).run();
    const post = await create();
    await repo.updatePostWithHistory(siteId, post.id,
      { contentMarkdown: `![image](/media-assets/${id})` }, actor, history, 1);
    await repo.updatePostWithHistory(siteId, post.id, { contentMarkdown: "Removed from draft" }, actor, history, 2);
    await expect(createD1AssetRepository(env.DB).deleteAsset(siteId, id)).rejects.toBeInstanceOf(ConflictError);
  });
});
