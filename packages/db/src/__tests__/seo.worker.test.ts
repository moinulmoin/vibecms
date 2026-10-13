/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext { migrations: D1Migration[] }
}

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { type Actor } from "@vc/core";
import { createD1PostRepository, createSeoReadModel, createSeoReviewsRepository } from "@vc/db";

const siteId = "seo-read-site";
const otherSiteId = "seo-read-other";
const actor: Actor = { type: "human", id: "seo-test-user", name: "Editor", role: "editor" };
const repo = createD1PostRepository(env.DB);
const reviews = createSeoReviewsRepository(env.DB);
const seo = createSeoReadModel(env.DB);
let sequence = 0;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('seo-ws', 'Site', 'seo-ws', 1, 1)").run();
  for (const id of [siteId, otherSiteId]) {
    await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, 'seo-ws', 'Site', ?, 1, 1)")
      .bind(id, id).run();
  }
});

async function create(input: { slug: string; title?: string; seoTitle?: string | null; seoDescription?: string | null; excerpt?: string | null; site?: string }) {
  const id = `seo-post-${++sequence}`;
  return repo.createPostWithHistory({
    id,
    siteId: input.site ?? siteId,
    title: input.title ?? `Title ${input.slug}`,
    slug: input.slug,
    excerpt: input.excerpt ?? null,
    contentMarkdown: "Body",
    coverAssetId: null,
    canonicalUrl: null,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    status: "draft",
    publishedAt: null,
    tags: [],
    presentation: null,
  }, actor, { changeSummary: "Created", activityAction: "post.created", activitySummary: "Created" });
}

async function publish(postId: string, version: number, site = siteId) {
  return repo.publishPostWithHistory(site, postId, version, actor,
    { changeSummary: "Published", activityAction: "post.published", activitySummary: "Published" },
    { billingActive: true, freeLimit: 100 });
}

describe("post_seo_reviews cache repository", () => {
  it("stores and returns a review keyed by post, version, and model; site-scoped", async () => {
    const post = await create({ slug: "cached-review" });
    const createdAt = 1_800_000_000;
    await reviews.put({
      siteId, postId: post.id, versionNumber: 1, model: "@cf/test/model-a",
      resultJson: '{"intent":"explain"}', neuronsEstimate: 71, createdAt,
    });
    expect(await reviews.get(siteId, post.id, 1, "@cf/test/model-a")).toEqual({
      postId: post.id, versionNumber: 1, model: "@cf/test/model-a",
      resultJson: '{"intent":"explain"}', neuronsEstimate: 71, createdAt,
    });
    expect(await reviews.get(siteId, post.id, 2, "@cf/test/model-a")).toBeNull();
    expect(await reviews.get(siteId, post.id, 1, "@cf/test/model-b")).toBeNull();
    expect(await reviews.get(otherSiteId, post.id, 1, "@cf/test/model-a")).toBeNull();
  });

  it("upserts on the (post, version, model) key and tolerates null estimates", async () => {
    const post = await create({ slug: "upserted-review" });
    await reviews.put({ siteId, postId: post.id, versionNumber: 1, model: "m", resultJson: "{}", createdAt: 100 });
    await reviews.put({ siteId, postId: post.id, versionNumber: 1, model: "m", resultJson: '{"v":2}', neuronsEstimate: null, createdAt: 200 });
    expect(await reviews.get(siteId, post.id, 1, "m")).toMatchObject({ resultJson: '{"v":2}', neuronsEstimate: null, createdAt: 200 });
    const rows = await env.DB.prepare("SELECT count(*) AS n FROM post_seo_reviews WHERE post_id = ?").bind(post.id).first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
});

describe("seo read model", () => {
  it("resolves live pinned slugs and live redirects, but not drafts, archived posts, other sites, or future publishes", async () => {
    const live = await create({ slug: "live-target" });
    await publish(live.id, 1);
    await create({ slug: "draft-target" });
    const foreign = await create({ slug: "foreign-target", site: otherSiteId });
    await publish(foreign.id, 1, otherSiteId);

    const moved = await create({ slug: "old-target" });
    await publish(moved.id, 1);
    await repo.updatePostWithHistory(siteId, moved.id, { slug: "new-target" }, actor,
      { changeSummary: "Renamed", activityAction: "post.updated", activitySummary: "Renamed" }, 1);
    await publish(moved.id, 2);

    const scheduled = await create({ slug: "scheduled-target" });
    await publish(scheduled.id, 1);
    await env.DB.prepare("UPDATE posts SET published_at = ? WHERE id = ?")
      .bind(Math.floor(Date.now() / 1000) + 3_600, scheduled.id).run();

    const candidates = ["live-target", "old-target", "new-target", "draft-target", "foreign-target", "scheduled-target", "missing"];
    const resolved = await seo.getPublishedSlugs(siteId, candidates);
    expect(new Set(resolved)).toEqual(new Set(["live-target", "old-target", "new-target"]));
  });

  it("chunks large candidate lists so links past the first chunk still resolve", async () => {
    // 'live-target' lands beyond the first 80-slot chunk.
    const candidates = Array.from({ length: 90 }, (_, i) => `slug-${i}`);
    candidates.push("live-target", "live-target");
    const resolved = await seo.getPublishedSlugs(siteId, candidates);
    expect(resolved.filter((slug) => slug === "live-target")).toEqual(["live-target"]);
    expect(await seo.getPublishedSlugs(siteId, [])).toEqual([]);
  });

  it("returns effective pinned fields for every other live post, never the mutable tip", async () => {
    const existing = await create({ slug: "existing-post", title: "Raw Title", seoTitle: "Custom SEO Title", seoDescription: "Shared description" });
    await publish(existing.id, 1);
    // Mutate the tip after publish: live fields must still come from v1.
    await repo.updatePostWithHistory(siteId, existing.id, { title: "Unpublished Title", seoDescription: "Unpublished description" }, actor,
      { changeSummary: "Edited", activityAction: "post.updated", activitySummary: "Edited" }, 1);

    const all = await seo.listPublishedSeoFields(siteId, null);
    expect(all).toContainEqual({ title: "Custom SEO Title", description: "Shared description" });
    expect(all.some((p) => p.title === "Unpublished Title" || p.description === "Unpublished description")).toBe(false);
    // Self-exclusion and site scoping.
    expect(await seo.listPublishedSeoFields(siteId, existing.id)).not.toContainEqual({ title: "Custom SEO Title", description: "Shared description" });
    expect((await seo.listPublishedSeoFields(otherSiteId, null)).some((p) => p.title === "Custom SEO Title")).toBe(false);
  });

  it("falls back to plain title and excerpt for effective fields, and keeps non-ASCII text unnormalized", async () => {
    const plain = await create({ slug: "plain-post", title: "Plain Post Title", excerpt: "Excerpt description" });
    await publish(plain.id, 1);
    expect(await seo.listPublishedSeoFields(siteId, null)).toContainEqual({ title: "Plain Post Title", description: "Excerpt description" });
    // Accented/uppercase values come back raw — the caller's Unicode-aware
    // normalizeForCompare decides equality, not SQLite's ASCII-only lower().
    const accented = await create({ slug: "accented-post", title: "Édition spéciale" });
    await publish(accented.id, 1);
    // fallback_excerpt supplies the description when neither override is set.
    expect(await seo.listPublishedSeoFields(siteId, null)).toContainEqual({ title: "Édition spéciale", description: "Body" });
  });
});
