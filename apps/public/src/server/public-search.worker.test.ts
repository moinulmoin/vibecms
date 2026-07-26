/**
 * Public blog tag + search + summary/feed data-layer tests.
 *
 * Covers:
 *   a. listPublishedPostSummariesByTag: same-site + tagged + published only.
 *   b. searchPublishedPostSummaries: finds a term present ONLY in post body.
 *   c. searchPublishedPostSummaries: site-scoped (cross-site term not returned).
 *   d. searchPublishedPostSummaries: % and _ wildcards are escaped (literal match).
 *   e. searchPublishedPostSummaries: draft posts are excluded.
 *   f. canonical_url projection on summaries + detail.
 *   g. summary rows never include content_markdown; caps + ordering hold.
 *   h. feed body projection stays capped and includes Markdown for RSS.
 *
 * Run via:
 *   pnpm --filter @vc/public test
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "cloudflare:test";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import {
  getPublishedPost as getPublishedPostData,
  listPublishedPostSummaries as listPublishedPostSummariesData,
  listPublishedPostSummariesByTag as listPublishedPostSummariesByTagData,
  listPublishedPostsForFeed as listPublishedPostsForFeedData,
  searchPublishedPostSummaries as searchPublishedPostSummariesData,
  PUBLIC_BLOG_LIMITS,
  type PostSummaryRow,
} from "./public-blog-data";

const getPublishedPost = (siteId: string, slug: string) => getPublishedPostData(env.DB, siteId, slug);
const listPublishedPostSummaries = (siteId: string, limit?: number) =>
  listPublishedPostSummariesData(env.DB, siteId, limit);
const listPublishedPostSummariesByTag = (siteId: string, tag: string, limit?: number) =>
  listPublishedPostSummariesByTagData(env.DB, siteId, tag, limit);
const searchPublishedPostSummaries = (siteId: string, query: string, limit?: number) =>
  searchPublishedPostSummariesData(env.DB, siteId, query, limit);
const listPublishedPostsForFeed = (siteId: string, limit?: number) =>
  listPublishedPostsForFeedData(env.DB, siteId, limit);

function assertSummaryRow(post: PostSummaryRow) {
  expect(post).not.toHaveProperty("content_markdown");
  expect(post).toHaveProperty("tags_json");
  expect(post).toHaveProperty("canonical_url");
  expect(post).toHaveProperty("cover_asset_id");
}

async function pinPublishedVersion(
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
  const versionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO post_versions (" +
      "id, post_id, site_id, version_number, title, slug, excerpt, content_markdown, " +
      "status, canonical_url, tags_json, created_by_type, created_by_id, change_summary, created_at" +
      ") VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'published', ?, ?, 'api_key', 'key-search', 'seed', ?)",
  )
    .bind(
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
    )
    .run();
  await env.DB.prepare("UPDATE posts SET published_version_id = ? WHERE id = ?")
    .bind(versionId, postId)
    .run();
}

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000) - 60;

  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("ws-search", "Search Workspace", "ws-search", ts, ts)
    .run();

  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind("site-search-x", "ws-search", "Site X", "site-search-x", ts, ts)
    .run();

  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind("site-search-y", "ws-search", "Site Y", "site-search-y", ts, ts)
    .run();

  const postCols =
    "id, site_id, title, slug, excerpt, content_markdown, tags_json, status, published_at, " +
    "created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";

  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psx-1",
      "site-search-x",
      "Rust Post",
      "rust-post",
      "A post about Rust systems programming.",
      "# Rust Post\nThis is about Rust. No secrets here.",
      '["rust","systems"]',
      "published",
      ts,
      "api_key",
      "key-search",
      "api_key",
      "key-search",
      ts,
      ts,
    )
    .run();

  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psx-2",
      "site-search-x",
      "Go Post",
      "go-post",
      "A post about Go concurrency.",
      "# Go Post\nThis is about Go.\nsecretbodyterm appears here only in the body.",
      '["golang"]',
      "published",
      ts - 10,
      "api_key",
      "key-search",
      "api_key",
      "key-search",
      ts,
      ts,
    )
    .run();

  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psx-3",
      "site-search-x",
      "Draft Rust Post",
      "draft-rust-post",
      "Draft excerpt.",
      "secretbodyterm in a draft post.",
      '["rust"]',
      "draft",
      ts,
      "api_key",
      "key-search",
      "api_key",
      "key-search",
      ts,
      ts,
    )
    .run();

  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psy-1",
      "site-search-y",
      "Site Y Rust Post",
      "site-y-rust",
      "Site Y Rust excerpt.",
      "secretbodyterm lives in the site-y post body.",
      '["rust"]',
      "published",
      ts,
      "api_key",
      "key-search",
      "api_key",
      "key-search",
      ts,
      ts,
    )
    .run();

  // Extra published posts on site-x to prove caps + newest-first ordering.
  for (let i = 4; i <= 6; i++) {
    const publishedAt = ts - i * 10;
    await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        `psx-${i}`,
        "site-search-x",
        `Extra Post ${i}`,
        `extra-post-${i}`,
        `Excerpt ${i}`,
        `# Extra ${i}`,
        "[]",
        "published",
        publishedAt,
        "api_key",
        "key-search",
        "api_key",
        "key-search",
        ts,
        ts,
      )
      .run();
    await pinPublishedVersion(`psx-${i}`, "site-search-x", {
      title: `Extra Post ${i}`,
      slug: `extra-post-${i}`,
      excerpt: `Excerpt ${i}`,
      contentMarkdown: `# Extra ${i}`,
      tagsJson: "[]",
      createdAt: publishedAt,
    });
  }

  await pinPublishedVersion("psx-1", "site-search-x", {
    title: "Rust Post",
    slug: "rust-post",
    excerpt: "A post about Rust systems programming.",
    contentMarkdown: "# Rust Post\nThis is about Rust. No secrets here.",
    tagsJson: '["rust","systems"]',
    createdAt: ts,
  });
  await pinPublishedVersion("psx-2", "site-search-x", {
    title: "Go Post",
    slug: "go-post",
    excerpt: "A post about Go concurrency.",
    contentMarkdown: "# Go Post\nThis is about Go.\nsecretbodyterm appears here only in the body.",
    tagsJson: '["golang"]',
    createdAt: ts - 10,
  });
  await pinPublishedVersion("psy-1", "site-search-y", {
    title: "Site Y Rust Post",
    slug: "site-y-rust",
    excerpt: "Site Y Rust excerpt.",
    contentMarkdown: "secretbodyterm lives in the site-y post body.",
    tagsJson: '["rust"]',
    createdAt: ts,
  });

  await env.DB.prepare(
    "INSERT INTO posts (id, site_id, title, slug, excerpt, content_markdown, tags_json, status, published_at, canonical_url, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "psx-can",
      "site-search-x",
      "Canonical Post",
      "canonical-post",
      "Excerpt.",
      "# body",
      "[]",
      "published",
      ts + 50,
      "https://elsewhere.example/original",
      "api_key",
      "key-search",
      "api_key",
      "key-search",
      ts,
      ts,
    )
    .run();
  await pinPublishedVersion("psx-can", "site-search-x", {
    title: "Canonical Post",
    slug: "canonical-post",
    excerpt: "Excerpt.",
    contentMarkdown: "# body",
    tagsJson: "[]",
    canonicalUrl: "https://elsewhere.example/original",
    createdAt: ts + 50,
  });
});

describe("a. listPublishedPostSummariesByTag", () => {
  it("returns only same-site published posts with the requested tag", async () => {
    const posts = await listPublishedPostSummariesByTag("site-search-x", "rust");
    const ids = posts.map((p) => p.id);
    expect(ids).toContain("psx-1");
    expect(ids).not.toContain("psx-2");
    expect(ids).not.toContain("psx-3");
    expect(ids).not.toContain("psy-1");
    for (const post of posts) assertSummaryRow(post);
  });

  it("returns empty array for an empty tag string", async () => {
    const posts = await listPublishedPostSummariesByTag("site-search-x", "");
    expect(posts).toHaveLength(0);
  });

  it("returns empty array when no published post has the tag", async () => {
    const posts = await listPublishedPostSummariesByTag("site-search-x", "nonexistent-tag");
    expect(posts).toHaveLength(0);
  });
});

describe("b. searchPublishedPostSummaries finds body-only term", () => {
  it("returns the post whose BODY (not title/excerpt/tags) contains the search term", async () => {
    const posts = await searchPublishedPostSummaries("site-search-x", "secretbodyterm");
    const ids = posts.map((p) => p.id);
    expect(ids).toContain("psx-2");
    expect(ids).not.toContain("psx-1");
    for (const post of posts) assertSummaryRow(post);
  });
});

describe("c. searchPublishedPostSummaries is site-scoped and published-only", () => {
  it("does not leak site-y post when querying site-x", async () => {
    const posts = await searchPublishedPostSummaries("site-search-x", "secretbodyterm");
    const ids = posts.map((p) => p.id);
    expect(ids).not.toContain("psy-1");
  });

  it("excludes draft posts even when the body matches", async () => {
    const posts = await searchPublishedPostSummaries("site-search-x", "secretbodyterm");
    const ids = posts.map((p) => p.id);
    expect(ids).not.toContain("psx-3");
  });

  it("returns empty array for an empty query", async () => {
    const posts = await searchPublishedPostSummaries("site-search-x", "");
    expect(posts).toHaveLength(0);
  });

  it("returns empty array for a whitespace-only query", async () => {
    const posts = await searchPublishedPostSummaries("site-search-x", "   ");
    expect(posts).toHaveLength(0);
  });
});

describe("d. LIKE wildcard escaping", () => {
  it("a bare % query does not match all published posts (% is treated as literal)", async () => {
    const posts = await searchPublishedPostSummaries("site-search-x", "%");
    expect(posts).toHaveLength(0);
  });

  it("a bare _ query does not match single-character content (_ is treated as literal)", async () => {
    const posts = await searchPublishedPostSummaries("site-search-x", "_");
    expect(posts).toHaveLength(0);
  });
});

describe("f. canonical_url projection", () => {
  it("listPublishedPostSummaries surfaces a stored canonical_url override", async () => {
    const posts = await listPublishedPostSummaries("site-search-x");
    const post = posts.find((p) => p.id === "psx-can");
    expect(post).toBeDefined();
    expect(post?.canonical_url).toBe("https://elsewhere.example/original");
    assertSummaryRow(post!);
  });

  it("getPublishedPost surfaces a stored canonical_url override", async () => {
    const post = await getPublishedPost("site-search-x", "canonical-post");
    expect(post).toBeDefined();
    expect(post?.canonical_url).toBe("https://elsewhere.example/original");
    expect(post?.content_markdown).toBe("# body");
  });

  it("returns canonical_url: null when the column is unset", async () => {
    const posts = await listPublishedPostSummaries("site-search-x");
    const rust = posts.find((p) => p.id === "psx-1");
    expect(rust?.canonical_url).toBeNull();
  });
});

describe("g. summary caps, ordering, and no body field", () => {
  it("list summaries are newest-first, capped, and body-free", async () => {
    const posts = await listPublishedPostSummaries("site-search-x", 2);
    expect(posts).toHaveLength(2);
    expect(posts[0]!.id).toBe("psx-can");
    expect(posts[1]!.id).toBe("psx-1");
    for (const post of posts) assertSummaryRow(post);
  });

  it("default list/search/llms caps come from the shared contract", () => {
    expect(PUBLIC_BLOG_LIMITS.listSummaries).toBe(200);
    expect(PUBLIC_BLOG_LIMITS.llmsSummaries).toBe(200);
    expect(PUBLIC_BLOG_LIMITS.sitemapSummaries).toBe(10_000);
    expect(PUBLIC_BLOG_LIMITS.feedBodies).toBe(50);
  });
});

describe("h. feed body projection", () => {
  it("returns Markdown bodies and respects the feed cap", async () => {
    const posts = await listPublishedPostsForFeed("site-search-x", 2);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toHaveProperty("content_markdown");
    expect(posts[0]!.content_markdown.length).toBeGreaterThan(0);
    expect(posts.map((p) => p.id)).toEqual(["psx-can", "psx-1"]);
  });

  it("default feed cap is 50", () => {
    expect(PUBLIC_BLOG_LIMITS.feedBodies).toBe(50);
  });
});
