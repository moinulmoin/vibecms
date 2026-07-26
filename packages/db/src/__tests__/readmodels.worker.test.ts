/**
 * Dashboard aggregate, export, and media read-model contracts under real miniflare D1.
 *
 * Phase 6 of the Drizzle migration extracted three read-heavy paths into @vc/db
 * read models reached via `createDataAccess(env.DB)`:
 *
 *   - dashboard.getDashboardAggregate — the 8-way parallel aggregate backing the
 *     cms dashboard. This suite defends the four contracts most at risk:
 *       (1) the 'scheduled'->'draft' status collapse (the posts DB CHECK allows a
 *           vestigial 'scheduled' value the Drizzle enum omits);
 *       (2) the revoked_at IS NULL filter on the api-token count;
 *       (3) the COALESCE-0 media sum on an asset-less site;
 *       (4) the newest-first, capped-at-5 recent feeds.
 *   - exports.getExportSite / listAllPostsForExport — owner export projection:
 *     ALL statuses returned, ordered updated_at DESC then id DESC.
 *   - assets.getMediaUsageBytes (site-scoped COALESCE SUM) and
 *     assets.getAssetForServe (by-id-only, intentionally NOT site-scoped) —
 *     the two opposing scoping models for the media surface.
 *
 * IDs are file-scoped ("rm-") so this file never collides with the other suites
 * sharing the miniflare D1 instance.
 *
 * Run via:
 *   pnpm --filter @vc/db test
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createDataAccess } from "@vc/db";

// Fixed epoch-second anchors. Every created_at/updated_at/published_at we seed
// is derived from T so the ordering and recency assertions are deterministic
// and never depend on Date.now() or test interleaving.
const T = 1_704_000_000;

// Shared data access over the real miniflare D1 binding.
const da = createDataAccess(env.DB);

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
  await seed();
});

// ---------------------------------------------------------------------------
// raw-SQL helpers (allowed in tests: we exercise the read models for reads)
// ---------------------------------------------------------------------------

async function exec(sql: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(sql).bind(...binds).run();
}

async function seed(): Promise<void> {
  // One workspace owns every site in this file.
  await exec(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    "rm-ws",
    "RM Workspace",
    "rm-ws",
    T,
    T,
  );

  // Four sites: a fully-seeded dashboard site, an empty dashboard site, an
  // export site, and a media site. Each is queried only by its own id.
  await exec(
    "INSERT INTO sites (id, workspace_id, name, slug, description, default_seo_title, default_seo_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rm-site-full",
    "rm-ws",
    "RM Full Site",
    "rm-site-full",
    "Full dashboard fixture",
    "RM Full SEO Title",
    "RM Full SEO Description",
    T,
    T,
  );
  await exec(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "rm-site-empty",
    "rm-ws",
    "RM Empty Site",
    "rm-site-empty",
    T,
    T,
  );
  await exec(
    "INSERT INTO sites (id, workspace_id, name, slug, description, default_seo_title, default_seo_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rm-site-export",
    "rm-ws",
    "RM Export Site",
    "rm-site-export",
    "Export fixture",
    "RM Export SEO Title",
    "RM Export SEO Description",
    T,
    T,
  );
  await exec(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "rm-site-media",
    "rm-ws",
    "RM Media Site",
    "rm-site-media",
    T,
    T,
  );
  await exec(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "rm-site-activation",
    "rm-ws",
    "RM Activation Site",
    "rm-site-activation",
    T,
    T,
  );

  await seedDashboardSite();
  await seedExportSite();
  await seedMediaSite();
  await seedActivationSite();
}

// Posts (incl. one 'scheduled' via raw SQL — the DB CHECK permits it even
// though the Drizzle enum omits it), assets, api keys (one active + one
// revoked), post versions, activity events, and three domains on rm-site-full.
async function seedDashboardSite(): Promise<void> {
  const site = "rm-site-full";
  // 7 posts spanning every status. created_by/updated_by are constant system
  // actor values; updated_at is what drives both status-free ordering and the
  // recentPosts feed. p4 is the 'scheduled' row that must collapse to 'draft'.
  const postActor = ["system", "rm-system"] as const;
  const posts: Array<[string, string, string, string, number | null, number]> = [
    // id, slug, status, title, publishedAt, updatedAt
    ["rm-p1", "post-1", "published", "Post 1", T + 5, T + 60],
    ["rm-p2", "post-2", "published", "Post 2", T + 5, T + 50],
    ["rm-p3", "post-3", "draft", "Post 3", null, T + 40],
    ["rm-p4", "post-4", "scheduled", "Post 4", null, T + 30],
    ["rm-p5", "post-5", "archived", "Post 5", T, T + 20],
    ["rm-p6", "post-6", "published", "Post 6", T, T + 10],
    ["rm-p7", "post-7", "draft", "Post 7", null, T],
  ];
  for (const [id, slug, status, title, publishedAt, updatedAt] of posts) {
    await exec(
      "INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      site,
      title,
      slug,
      `# ${title}`,
      status,
      publishedAt,
      "[]",
      ...postActor,
      ...postActor,
      T,
      updatedAt,
    );
  }

  // 3 assets -> media bytes = 1000 + 2000 + 4000 = 7000, count = 3.
  const assets: Array<[string, string, string, string, number]> = [
    // id, r2_key, filename, mime_type, size_bytes
    ["rm-asset-1", "rm-r2k-1", "a.png", "image/png", 1000],
    ["rm-asset-2", "rm-r2k-2", "b.png", "image/png", 2000],
    ["rm-asset-3", "rm-r2k-3", "c.png", "image/png", 4000],
  ];
  for (const [id, r2Key, filename, mimeType, sizeBytes] of assets) {
    await exec(
      "INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes, created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      site,
      r2Key,
      filename,
      mimeType,
      sizeBytes,
      "system",
      "rm-system",
      T,
      T,
    );
  }

  // 1 active + 1 revoked api key -> tokenCount must be 1 (active only).
  await exec(
    "INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rm-key-active",
    site,
    "Active key",
    "rm-live_",
    "rm-hash-active",
    "[]",
    "RM System",
    "rm-user",
    null,
    T,
    T,
  );
  await exec(
    "INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rm-key-revoked",
    site,
    "Revoked key",
    "rm-rev_",
    "rm-hash-revoked",
    "[]",
    "RM System",
    "rm-user",
    T + 100,
    T,
    T,
  );

  // 4 post versions on rm-p1 -> versionCount = 4.
  for (let v = 1; v <= 4; v++) {
    await exec(
      "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, tags_json, created_by_type, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `rm-pv-${v}`,
      "rm-p1",
      site,
      v,
      "Post 1",
      "post-1",
      "# Post 1",
      "draft",
      "[]",
      "system",
      "rm-system",
      T,
    );
  }

  // 7 activity events with distinct createdAt -> recentActivity caps at 5,
  // newest first.
  for (let i = 1; i <= 7; i++) {
    await exec(
      "INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `rm-act-${i}`,
      site,
      "system",
      "rm-system",
      "RM System",
      "post.updated",
      "post",
      "rm-p1",
      `Activity ${i}`,
      T + (8 - i) * 10, // rm-act-1 newest (T+70) ... rm-act-7 oldest (T+10)
    );
  }

  // Three domains on the site. INSERTION ORDER IS LOAD-BEARING for the
  // activeDefaultHostname teeth: the default+pending row is inserted FIRST so
  // that if the read model dropped its `status = 'active'` filter, the pending
  // row (lowest rowid) would be returned instead of the active one and the
  // assertion would fail. Likewise the custom+active row guards the
  // `type = 'default'` filter.
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    "rm-dom-pending",
    site,
    "rm-pending.default.test",
    "default",
    "pending",
    T,
    T,
  );
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    "rm-dom-custom",
    site,
    "rm-custom.default.test",
    "custom",
    "active",
    T,
    T,
  );
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    "rm-dom-active",
    site,
    "rm-active.default.test",
    "default",
    "active",
    T,
    T,
  );
}

// Activation-proof fixtures for getActivationPost on rm-site-activation: an
// api_key-published post (live), an api_key-created draft (draft), a
// human-only published post (must NOT count), and a post version on the draft.
async function seedActivationSite(): Promise<void> {
  const site = "rm-site-activation";
  const insPost = (
    id: string, slug: string, status: string, publishedAt: number | null, updatedAt: number,
    byType: string, byId: string,
  ) =>
    exec(
      "INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, site, id, slug, `# ${id}`, status, publishedAt, "[]", byType, byId, byType, byId, T, updatedAt,
    );
  const insAct = (
    id: string, actorType: string, actorId: string, actorName: string, action: string,
    entityId: string, createdAt: number,
  ) =>
    exec(
      "INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, site, actorType, actorId, actorName, action, "post", entityId, `${action} ${entityId}`, createdAt,
    );

  // api_key published post -> LIVE activation proof.
  await insPost("rm-act-live", "live-agent", "published", T + 5, T + 60, "api_key", "rm-key-agent");
  await insAct("rm-act-live-evt", "api_key", "rm-key-agent", "Agent Key", "post.published", "rm-act-live", T + 60);

  // api_key draft post -> DRAFT activation proof (only when no live post exists).
  await insPost("rm-act-draft", "draft-agent", "draft", null, T + 40, "api_key", "rm-key-agent");
  await insAct("rm-act-draft-evt", "api_key", "rm-key-agent", "Agent Key", "post.created", "rm-act-draft", T + 40);

  // Human-only published post -> must NEVER activate (excluded by actor_type).
  await insPost("rm-act-human", "human-post", "published", T + 5, T + 70, "human", "rm-user-human");
  await insAct("rm-act-human-evt", "human", "rm-user-human", "Human User", "post.published", "rm-act-human", T + 70);

  // A post version on the draft so versionNumber resolves to 3 (not 0).
  await exec(
    "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, tags_json, created_by_type, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rm-act-pv-1", "rm-act-draft", site, 3, "rm-act-draft", "draft-agent", "# draft", "draft", "[]", "api_key", "rm-key-agent", T,
  );
}

// 4 posts across draft/published/archived. rm-exp-a and rm-exp-b share an
// updated_at to prove the id-DESC tiebreak (a is inserted before b, so without
// the id-DESC tiebreak the rowid order a-then-b would fail the assertion).
async function seedExportSite(): Promise<void> {
  const site = "rm-site-export";
  const postActor = ["system", "rm-system"] as const;
  const rows: Array<[string, string, string, string, number | null, number, string]> = [
    // id, slug, status, title, publishedAt, updatedAt, tagsJson
    ["rm-exp-new", "exp-new", "published", "Export New", T + 5, T + 100, '["new"]'],
    ["rm-exp-a", "exp-a", "draft", "Export A", null, T + 50, '["alpha"]'],
    ["rm-exp-b", "exp-b", "published", "Export B", T + 50, T + 50, '["beta","gamma"]'],
    ["rm-exp-old", "exp-old", "archived", "Export Old", T, T, "[]"],
  ];
  for (const [id, slug, status, title, publishedAt, updatedAt, tagsJson] of rows) {
    await exec(
      "INSERT INTO posts (id, site_id, title, slug, excerpt, content_markdown, status, published_at, tags_json, seo_title, seo_description, canonical_url, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      site,
      title,
      slug,
      `Excerpt ${title}`,
      `# ${title}`,
      status,
      publishedAt,
      tagsJson,
      `SEO ${title}`,
      `SEO desc ${title}`,
      `https://example.test/${slug}`,
      ...postActor,
      ...postActor,
      T,
      updatedAt,
    );
  }
}

// 2 assets -> usage 500 + 1500 = 2000. The first carries a non-null altText so
// getAssetForServe's camelCase altText mapping is asserted on a real value.
async function seedMediaSite(): Promise<void> {
  const site = "rm-site-media";
  await exec(
    "INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes, alt_text, created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rm-asset-media-1",
    site,
    "rm-r2k-media-1",
    "one.png",
    "image/png",
    500,
    "alt text one",
    "system",
    "rm-system",
    T,
    T,
  );
  await exec(
    "INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes, created_by_type, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "rm-asset-media-2",
    site,
    "rm-r2k-media-2",
    "two.jpg",
    "image/jpeg",
    1500,
    "system",
    "rm-system",
    T,
    T,
  );
}

// ===========================================================================
// dashboard.getDashboardAggregate
// ===========================================================================

describe("dashboard.getDashboardAggregate — seeded site", () => {
  it("returns the site projection {name, slug}", async () => {
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    expect(agg.site).toEqual({ name: "RM Full Site", slug: "rm-site-full" });
  });

  it("collapses 'scheduled' into draft and counts the rest by status", async () => {
    // Seeded: published = p1,p2,p6 (3); draft = p3 + p4('scheduled') + p7 (3);
    // archived = p5 (1). If the scheduled->draft collapse were dropped, draft
    // would read 2 (p3+p7) instead of 3, reddening this assertion.
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    expect(agg.counts).toEqual({ published: 3, draft: 3, archived: 1 });
  });

  it("sums media bytes and counts assets", async () => {
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    // 1000 + 2000 + 4000.
    expect(agg.media).toEqual({ bytes: 7000, count: 3 });
  });

  it("counts only non-revoked api keys", async () => {
    // One active + one revoked -> tokenCount must be 1. If the revoked_at IS
    // NULL filter were dropped, this would read 2.
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    expect(agg.tokenCount).toBe(1);
  });

  it("counts post versions", async () => {
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    expect(agg.versionCount).toBe(4);
  });

  it("returns recentPosts newest-first capped at 5, with scheduled collapsed to draft", async () => {
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    // updated_at desc: p1(+60), p2(+50), p3(+40), p4(+30), p5(+20). p6(+10)
    // and p7(0) fall off the 5-row cap.
    expect(agg.recentPosts.map((p) => p.id)).toEqual([
      "rm-p1",
      "rm-p2",
      "rm-p3",
      "rm-p4",
      "rm-p5",
    ]);
    // p4 was seeded 'scheduled'; its projected status must be 'draft'. This
    // defends the collapse in the recentPosts projection independently of the
    // status-count collapse above.
    const p4 = agg.recentPosts.find((p) => p.id === "rm-p4");
    expect(p4?.status).toBe("draft");
    // The newest row carries its full projection shape incl. publishedAt.
    expect(agg.recentPosts[0]).toMatchObject({
      id: "rm-p1",
      title: "Post 1",
      slug: "post-1",
      status: "published",
      updatedAt: T + 60,
      publishedAt: T + 5,
    });
  });

  it("returns recentActivity newest-first capped at 5", async () => {
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    // rm-act-1 is the newest (T+70) ... rm-act-5 (T+30); act-6/act-7 fall off.
    expect(agg.recentActivity.map((a) => a.summary)).toEqual([
      "Activity 1",
      "Activity 2",
      "Activity 3",
      "Activity 4",
      "Activity 5",
    ]);
    expect(agg.recentActivity[0]).toMatchObject({
      action: "post.updated",
      actorName: "RM System",
      createdAt: T + 70,
    });
  });

  it("returns the active default-domain hostname, filtering out custom and non-active defaults", async () => {
    const agg = await da.dashboard.getDashboardAggregate("rm-site-full");
    // Exactly one row satisfies type='default' AND status='active'. The pending
    // default (lowest rowid) and the active custom domain must both be excluded
    // — if either filter were dropped, a different hostname would surface.
    expect(agg.activeDefaultHostname).toBe("rm-active.default.test");
  });
});

describe("dashboard.getDashboardAggregate — empty site", () => {
  it("COALESCEs every aggregate to zero/empty with the site projection intact", async () => {
    const agg = await da.dashboard.getDashboardAggregate("rm-site-empty");
    expect(agg.site).toEqual({ name: "RM Empty Site", slug: "rm-site-empty" });
    expect(agg.counts).toEqual({ published: 0, draft: 0, archived: 0 });
    // COALESCE(SUM(size_bytes),0) on an asset-less site yields bytes 0 (a raw
    // SUM would be NULL, not 0).
    expect(agg.media).toEqual({ bytes: 0, count: 0 });
    expect(agg.tokenCount).toBe(0);
    expect(agg.versionCount).toBe(0);
    expect(agg.recentPosts).toEqual([]);
    expect(agg.recentActivity).toEqual([]);
    expect(agg.activeDefaultHostname).toBeNull();
  });
});

// ===========================================================================
// exports
// ===========================================================================

describe("exports.getExportSite", () => {
  it("returns the full owner export projection for a known site", async () => {
    const site = await da.exports.getExportSite("rm-site-export");
    expect(site).toEqual({
      id: "rm-site-export",
      name: "RM Export Site",
      slug: "rm-site-export",
      description: "Export fixture",
      defaultSeoTitle: "RM Export SEO Title",
      defaultSeoDescription: "RM Export SEO Description",
    });
  });

  it("returns null for an unknown site id", async () => {
    expect(await da.exports.getExportSite("rm-site-unknown")).toBeNull();
  });
});

describe("exports.listAllPostsForExport", () => {
  it("returns posts of every status ordered by updated_at desc then id desc, with raw tagsJson", async () => {
    const posts = await da.exports.listAllPostsForExport("rm-site-export");
    // updated_at desc, id desc tiebreak: rm-exp-b precedes rm-exp-a despite an
    // equal updated_at (and despite a being inserted first). If the id-DESC
    // tiebreak were dropped, the rowid order a-then-b would break this.
    expect(posts.map((p) => p.id)).toEqual([
      "rm-exp-new",
      "rm-exp-b",
      "rm-exp-a",
      "rm-exp-old",
    ]);

    // All three owner-visible statuses are present — export is NOT filtered to
    // published only.
    expect(posts.map((p) => p.status).sort()).toEqual([
      "archived",
      "draft",
      "published",
      "published",
    ]);

    // tagsJson is passed through raw (the app layer parses it), not decoded.
    expect(posts[0].tagsJson).toBe('["new"]');
    expect(posts.find((p) => p.id === "rm-exp-b")!.tagsJson).toBe('["beta","gamma"]');

    // Full post projection is present on the newest row.
    expect(posts[0]).toMatchObject({
      id: "rm-exp-new",
      title: "Export New",
      slug: "exp-new",
      excerpt: "Excerpt Export New",
      contentMarkdown: "# Export New",
      status: "published",
      publishedAt: T + 5,
      seoTitle: "SEO Export New",
      seoDescription: "SEO desc Export New",
      canonicalUrl: "https://example.test/exp-new",
      coverAssetId: null,
      createdAt: T,
      updatedAt: T + 100,
    });
  });
});

// ===========================================================================
// assets — media usage (site-scoped) and serve lookup (by id only)
// ===========================================================================

describe("assets.getMediaUsageBytes — site-scoped COALESCE SUM", () => {
  it("returns the exact byte sum for a site with assets", async () => {
    // 500 + 1500 = 2000. If the site filter were dropped, this would read the
    // cross-site total (7000 + 2000 = 9000), reddening the assertion.
    expect(await da.assets.getMediaUsageBytes("rm-site-media")).toBe(2000);
  });

  it("coalesces to 0 for a site with no assets", async () => {
    // rm-site-empty has zero assets; a raw SUM would be NULL, not 0.
    expect(await da.assets.getMediaUsageBytes("rm-site-empty")).toBe(0);
  });
});

describe("assets.getAssetForServe — by-id, not site-scoped", () => {
  it("returns the serve row by id alone with camelCase fields", async () => {
    // Called with ONLY the asset id — no site context. Returning rm-asset-media-1
    // (which belongs to rm-site-media) proves the lookup is by-id and not
    // site-scoped; the site-scoped counterpart is getMediaUsageBytes above.
    const row = await da.assets.getAssetForServe("rm-asset-media-1");
    expect(row).toEqual({
      id: "rm-asset-media-1",
      siteId: "rm-site-media",
      r2Key: "rm-r2k-media-1",
      filename: "one.png",
      mimeType: "image/png",
      sizeBytes: 500,
      altText: "alt text one",
    });
  });

  it("returns null for an unknown asset id", async () => {
    expect(await da.assets.getAssetForServe("rm-asset-unknown")).toBeNull();
  });
});

// ===========================================================================
// dashboard.getActivationPost — site-level api_key activation proof
// ===========================================================================

describe("dashboard.getActivationPost — live wins, draft fallback, human excluded", () => {
  it("returns the live api_key-published post and ignores human-only publishes", async () => {
    const proof = await da.dashboard.getActivationPost("rm-site-activation");
    // The human post (rm-act-human) was published LATER (T+70) than the agent
    // post (T+60). If actor_type were not filtered, the human post would win.
    expect(proof.state).toBe("live");
    if (proof.state !== "live") return;
    expect(proof.post.id).toBe("rm-act-live");
    expect(proof.post).toMatchObject({ title: "rm-act-live", slug: "live-agent", publishedAt: T + 5 });
    expect(proof.actorName).toBe("Agent Key");
  });

  it("uses the publish activity time when a legacy published row has no publishedAt", async () => {
    await exec(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      "rm-site-live-null-time", "rm-ws", "RM Live Null Time", "rm-site-live-null-time", T, T,
    );
    await exec(
      "INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "rm-live-null-time", "rm-site-live-null-time", "Null Time", "null-time", "# live", "published", null, "[]", "api_key", "rm-null-key", "api_key", "rm-null-key", T, T + 42,
    );
    await exec(
      "INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "rm-live-null-event", "rm-site-live-null-time", "api_key", "rm-null-key", "Null Key", "post.published", "post", "rm-live-null-time", "published", T + 42,
    );

    const proof = await da.dashboard.getActivationPost("rm-site-live-null-time");
    expect(proof.state).toBe("live");
    if (proof.state !== "live") return;
    expect(proof.post.publishedAt).toBe(T + 42);
  });

  it("falls back to the latest api_key draft only when no live post exists", async () => {
    // On rm-site-full every activity is actor_type='system' (no api_key rows),
    // and the published posts were never attributed to an api_key -> waiting.
    const proof = await da.dashboard.getActivationPost("rm-site-full");
    expect(proof.state).toBe("waiting");
  });

  it("returns waiting on a site with no api_key activity", async () => {
    const proof = await da.dashboard.getActivationPost("rm-site-empty");
    expect(proof.state).toBe("waiting");
  });
});

describe("dashboard.getActivationPost — draft attribution with versionNumber", () => {
  it("returns the api_key draft (with current max version) when only a draft exists", async () => {
    // Seed an isolated site with ONLY an api_key draft (no live post).
    await exec(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      "rm-site-draft-only", "rm-ws", "RM Draft Only", "rm-site-draft-only", T, T,
    );
    await exec(
      "INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "rm-do-draft", "rm-site-draft-only", "rm-do-draft", "do-draft", "# d", "draft", null, "[]", "api_key", "rm-do-key", "api_key", "rm-do-key", T, T + 30,
    );
    await exec(
      "INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "rm-do-evt", "rm-site-draft-only", "api_key", "rm-do-key", "DO Key", "post.created", "post", "rm-do-draft", "created", T + 30,
    );
    await exec(
      "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, tags_json, created_by_type, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "rm-do-pv-2", "rm-do-draft", "rm-site-draft-only", 2, "rm-do-draft", "do-draft", "# d", "draft", "[]", "api_key", "rm-do-key", T,
    );

    const proof = await da.dashboard.getActivationPost("rm-site-draft-only");
    expect(proof.state).toBe("draft");
    if (proof.state !== "draft") return;
    expect(proof.post).toMatchObject({ id: "rm-do-draft", slug: "do-draft", updatedAt: T + 30, versionNumber: 2 });
  });
});
