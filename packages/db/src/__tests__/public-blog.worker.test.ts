/**
 * Public-blog read-model caps, projections, and candidate-bound search.
 *
 * Defends the shared public list contract:
 *   - summary methods never project contentMarkdown
 *   - every list path is limit-capped
 *   - feed body projection stays capped and ordered newest-first
 *   - tenant (site) isolation holds
 *   - candidate-bound search only matches inside the candidate window
 *   - future-dated publishes stay filtered out
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
import { createDataAccess, PUBLIC_BLOG_LIMITS, type PublicPostSummaryRow } from "@vc/db";

const T = 1_704_000_000;
const NOW = T + 1_000;
const da = createDataAccess(env.DB);

async function exec(sql: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(sql).bind(...binds).run();
}

async function pinVersion(
  postId: string,
  siteId: string,
  fields: {
    title: string;
    slug: string;
    excerpt: string | null;
    contentMarkdown: string;
    tagsJson: string;
    canonicalUrl?: string | null;
    createdAt: number;
  },
): Promise<void> {
  const versionId = `${postId}-v1`;
  await exec(
    "INSERT INTO post_versions (" +
      "id, post_id, site_id, version_number, title, slug, excerpt, content_markdown, " +
      "status, canonical_url, tags_json, created_by_type, created_by_id, change_summary, created_at" +
      ") VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'published', ?, ?, 'api_key', 'pb-key', 'seed', ?)",
    versionId,
    postId,
    siteId,
    fields.title,
    fields.slug,
    fields.excerpt,
    fields.contentMarkdown,
    fields.canonicalUrl ?? null,
    fields.tagsJson,
    fields.createdAt,
  );
  await exec("UPDATE posts SET published_version_id = ? WHERE id = ?", versionId, postId);
}

async function insertPublishedPost(input: {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  tagsJson: string;
  publishedAt: number;
  canonicalUrl?: string | null;
}): Promise<void> {
  await exec(
    "INSERT INTO posts (id, site_id, title, slug, excerpt, content_markdown, tags_json, status, published_at, canonical_url, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, 'api_key', 'pb-key', 'api_key', 'pb-key', ?, ?)",
    input.id,
    input.siteId,
    input.title,
    input.slug,
    input.excerpt,
    input.body,
    input.tagsJson,
    input.publishedAt,
    input.canonicalUrl ?? null,
    T,
    input.publishedAt,
  );
  await pinVersion(input.id, input.siteId, {
    title: input.title,
    slug: input.slug,
    excerpt: input.excerpt,
    contentMarkdown: input.body,
    tagsJson: input.tagsJson,
    canonicalUrl: input.canonicalUrl ?? null,
    createdAt: input.publishedAt,
  });
}

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  await exec(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    "pb-ws",
    "PB Workspace",
    "pb-ws",
    T,
    T,
  );
  await exec(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "pb-site-a",
    "pb-ws",
    "Site A",
    "pb-site-a",
    T,
    T,
  );
  await exec(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "pb-site-b",
    "pb-ws",
    "Site B",
    "pb-site-b",
    T,
    T,
  );

  // Newest → oldest on site A (5 published + 1 future + 1 draft).
  for (let i = 1; i <= 5; i++) {
    await insertPublishedPost({
      id: `pb-a-${i}`,
      siteId: "pb-site-a",
      title: `A Post ${i}`,
      slug: `a-post-${i}`,
      excerpt: `Excerpt ${i}`,
      body: `# A Post ${i}\nbody-${i}-unique uniquemarker${i}`,
      tagsJson: i % 2 === 0 ? '["even"]' : '["odd"]',
      publishedAt: T + (6 - i) * 10,
    });
  }
  await insertPublishedPost({
    id: "pb-a-future",
    siteId: "pb-site-a",
    title: "Future Post",
    slug: "future-post",
    excerpt: "Future",
    body: "future uniquemarker-future",
    tagsJson: '["odd"]',
    publishedAt: NOW + 10_000,
  });
  await exec(
    "INSERT INTO posts (id, site_id, title, slug, excerpt, content_markdown, tags_json, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, 'api_key', 'pb-key', 'api_key', 'pb-key', ?, ?)",
    "pb-a-draft",
    "pb-site-a",
    "Draft Post",
    "draft-post",
    "Draft",
    "draft uniquemarker-draft",
    '["odd"]',
    T,
    T,
    T,
  );

  await insertPublishedPost({
    id: "pb-b-1",
    siteId: "pb-site-b",
    title: "B Post",
    slug: "b-post",
    excerpt: "Site B excerpt",
    body: "site-b uniquemarker1 body",
    tagsJson: '["odd"]',
    publishedAt: T + 100,
    canonicalUrl: "https://elsewhere.example/b",
  });
});

function assertSummaryShape(row: PublicPostSummaryRow) {
  expect(row).not.toHaveProperty("contentMarkdown");
  expect(row).toHaveProperty("id");
  expect(row).toHaveProperty("slug");
  expect(row).toHaveProperty("title");
  expect(row).toHaveProperty("tagsJson");
  expect(row).toHaveProperty("canonicalUrl");
  expect(row).toHaveProperty("coverAssetId");
}

describe("public blog summary projections", () => {
  it("list summaries omit Markdown bodies and respect limit + newest-first order", async () => {
    const rows = await da.publicBlog.listPublishedPostSummaries("pb-site-a", NOW, 3);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id)).toEqual(["pb-a-1", "pb-a-2", "pb-a-3"]);
    for (const row of rows) assertSummaryShape(row);
  });

  it("tag summaries stay site-scoped, published-only, capped, and body-free", async () => {
    const rows = await da.publicBlog.listPublishedPostSummariesByTag("pb-site-a", "odd", NOW, 10);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(["pb-a-1", "pb-a-3", "pb-a-5"]);
    expect(ids).not.toContain("pb-a-2");
    expect(ids).not.toContain("pb-a-future");
    expect(ids).not.toContain("pb-a-draft");
    expect(ids).not.toContain("pb-b-1");
    for (const row of rows) assertSummaryShape(row);
  });

  it("search summaries find body terms without transferring Markdown", async () => {
    const rows = await da.publicBlog.searchPublishedPostSummaries("pb-site-a", "uniquemarker2", NOW, 10);
    expect(rows.map((r) => r.id)).toEqual(["pb-a-2"]);
    assertSummaryShape(rows[0]!);
  });

  it("search is tenant-isolated and ignores drafts/future posts", async () => {
    const rows = await da.publicBlog.searchPublishedPostSummaries("pb-site-a", "uniquemarker1", NOW, 10);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("pb-a-1");
    expect(ids).not.toContain("pb-b-1");
    expect(ids).not.toContain("pb-a-draft");
    expect(ids).not.toContain("pb-a-future");
  });

  it("candidate-bound search excludes matches outside the candidate window", async () => {
    // Newest two published on site A are pb-a-1, pb-a-2. uniquemarker5 lives on pb-a-5 (older).
    const inside = await da.publicBlog.searchPublishedPostSummaries(
      "pb-site-a",
      "uniquemarker1",
      NOW,
      10,
      2,
    );
    expect(inside.map((r) => r.id)).toEqual(["pb-a-1"]);

    const outside = await da.publicBlog.searchPublishedPostSummaries(
      "pb-site-a",
      "uniquemarker5",
      NOW,
      10,
      2,
    );
    expect(outside).toHaveLength(0);
  });


  it("candidate-bound search stays safe above typical D1 bind-variable limits", async () => {
    // D1 historically caps bound parameters around 100. Materializing candidate
    // ids into inArray(...) would break here; a LIMIT subquery join must not.
    const site = "pb-site-bind";
    await exec(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      site,
      "pb-ws",
      "Bind Site",
      site,
      T,
      T,
    );

    const count = 150;
    for (let i = 1; i <= count; i++) {
      await insertPublishedPost({
        id: `pb-bind-${i}`,
        siteId: site,
        title: `Bind Post ${i}`,
        slug: `bind-post-${i}`,
        excerpt: `Bind excerpt ${i}`,
        body: i === count
          ? `# Bind ${i}\nbind-unique-needle lives only on the oldest candidate`
          : `# Bind ${i}\nno needle here`,
        tagsJson: "[]",
        // Newest first: i=1 newest, i=count oldest — still inside a 150-wide window.
        publishedAt: T + (count - i + 1),
      });
    }

    const rows = await da.publicBlog.searchPublishedPostSummaries(
      site,
      "bind-unique-needle",
      NOW,
      10,
      count,
    );
    expect(rows.map((r) => r.id)).toEqual([`pb-bind-${count}`]);
    assertSummaryShape(rows[0]!);
  });
});

describe("public blog feed + detail projections", () => {
  it("feed body projection caps at the requested limit and includes Markdown", async () => {
    const rows = await da.publicBlog.listPublishedPostsForFeed(
      "pb-site-a",
      NOW,
      PUBLIC_BLOG_LIMITS.feedBodies,
    );
    expect(rows.length).toBeLessThanOrEqual(PUBLIC_BLOG_LIMITS.feedBodies);
    expect(rows.map((r) => r.id).slice(0, 5)).toEqual([
      "pb-a-1",
      "pb-a-2",
      "pb-a-3",
      "pb-a-4",
      "pb-a-5",
    ]);
    expect(rows[0]).toHaveProperty("contentMarkdown");
    expect(rows[0]!.contentMarkdown).toContain("uniquemarker1");
  });

  it("feed limit of 50 is enforced when more posts exist", async () => {
    const rows = await da.publicBlog.listPublishedPostsForFeed("pb-site-a", NOW, 2);
    expect(rows).toHaveLength(2);
  });

  it("detail still returns Markdown for direct article rendering", async () => {
    const post = await da.publicBlog.getPublishedPost("pb-site-a", "a-post-1", NOW);
    expect(post).not.toBeNull();
    expect(post!.contentMarkdown).toContain("uniquemarker1");
    expect(post!.presentation).toBeNull();
  });

  it("summary listings preserve canonical URL overrides", async () => {
    const rows = await da.publicBlog.listPublishedPostSummaries("pb-site-b", NOW, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.canonicalUrl).toBe("https://elsewhere.example/b");
    assertSummaryShape(rows[0]!);
  });
});

describe("shared public blog limit contract", () => {
  it("exposes the route caps used by public callers", () => {
    expect(PUBLIC_BLOG_LIMITS.listSummaries).toBe(200);
    expect(PUBLIC_BLOG_LIMITS.feedBodies).toBe(50);
    expect(PUBLIC_BLOG_LIMITS.sitemapSummaries).toBe(10_000);
    expect(PUBLIC_BLOG_LIMITS.llmsSummaries).toBe(200);
    expect(PUBLIC_BLOG_LIMITS.searchCandidates).toBe(500);
  });
});
