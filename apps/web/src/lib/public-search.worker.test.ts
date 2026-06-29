/**
 * Public blog tag + search data-layer tests.
 *
 * Covers Wave 1A acceptance criteria:
 *   a. listPublishedPostsByTag: same-site + tagged + published only.
 *   b. searchPublishedPosts: finds a term present ONLY in post body.
 *   c. searchPublishedPosts: site-scoped (cross-site term not returned).
 *   d. searchPublishedPosts: % and _ wildcards are escaped (literal match).
 *   e. searchPublishedPosts: draft posts are excluded.
 *
 * Run via:
 *   pnpm --filter @vc/web test:isolation
 *
 * Runs inside @cloudflare/vitest-pool-workers with a real miniflare D1.
 * All migrations are applied before tests; IDs are unique to this file.
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "cloudflare:test";

// Augment ProvidedContext so inject('migrations') type-checks correctly.
declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { listPublishedPostsByTag, searchPublishedPosts } from "../server/public-blog-data";

// ---------------------------------------------------------------------------
// Setup: apply migrations + seed test data once per file
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000) - 60; // 60 s in the past

  // workspace
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("ws-search", "Search Workspace", "ws-search", ts, ts)
    .run();

  // two sites
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

  // site-x post 1: tag "rust", body has NO secretbodyterm
  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psx-1", "site-search-x", "Rust Post", "rust-post",
      "A post about Rust systems programming.",
      "# Rust Post\nThis is about Rust. No secrets here.",
      '["rust","systems"]', "published", ts,
      "api_key", "key-search", "api_key", "key-search", ts, ts,
    )
    .run();

  // site-x post 2: tag "golang", body contains "secretbodyterm" ONLY (not in title/excerpt/tags)
  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psx-2", "site-search-x", "Go Post", "go-post",
      "A post about Go concurrency.",
      "# Go Post\nThis is about Go.\nsecretbodyterm appears here only in the body.",
      '["golang"]', "published", ts,
      "api_key", "key-search", "api_key", "key-search", ts, ts,
    )
    .run();

  // site-x post 3: tag "rust" but DRAFT - must not appear in any query
  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psx-3", "site-search-x", "Draft Rust Post", "draft-rust-post",
      "Draft excerpt.",
      "secretbodyterm in a draft post.",
      '["rust"]', "draft", ts,
      "api_key", "key-search", "api_key", "key-search", ts, ts,
    )
    .run();

  // site-y post 1: tag "rust", body contains "secretbodyterm" - must NOT appear for site-x queries
  await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      "psy-1", "site-search-y", "Site Y Rust Post", "site-y-rust",
      "Site Y Rust excerpt.",
      "secretbodyterm lives in the site-y post body.",
      '["rust"]', "published", ts,
      "api_key", "key-search", "api_key", "key-search", ts, ts,
    )
    .run();
});

// ---------------------------------------------------------------------------
// a. listPublishedPostsByTag
// ---------------------------------------------------------------------------

describe("a. listPublishedPostsByTag", () => {
  it("returns only same-site published posts with the requested tag", async () => {
    const posts = await listPublishedPostsByTag("site-search-x", "rust");
    const ids = posts.map((p) => p.id);
    // site-x rust post is returned
    expect(ids).toContain("psx-1");
    // site-x golang post is NOT returned (different tag)
    expect(ids).not.toContain("psx-2");
    // site-x draft rust post is NOT returned (draft)
    expect(ids).not.toContain("psx-3");
    // site-y rust post is NOT returned (different site)
    expect(ids).not.toContain("psy-1");
  });

  it("returns empty array for an empty tag string", async () => {
    const posts = await listPublishedPostsByTag("site-search-x", "");
    expect(posts).toHaveLength(0);
  });

  it("returns empty array when no published post has the tag", async () => {
    const posts = await listPublishedPostsByTag("site-search-x", "nonexistent-tag");
    expect(posts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// b + c. searchPublishedPosts
// ---------------------------------------------------------------------------

describe("b. searchPublishedPosts finds body-only term", () => {
  it("returns the post whose BODY (not title/excerpt/tags) contains the search term", async () => {
    const posts = await searchPublishedPosts("site-search-x", "secretbodyterm");
    const ids = posts.map((p) => p.id);
    // psx-2 has secretbodyterm only in content_markdown
    expect(ids).toContain("psx-2");
    // psx-1 does not have it anywhere
    expect(ids).not.toContain("psx-1");
  });
});

describe("c. searchPublishedPosts is site-scoped and published-only", () => {
  it("does not leak site-y post when querying site-x", async () => {
    const posts = await searchPublishedPosts("site-search-x", "secretbodyterm");
    const ids = posts.map((p) => p.id);
    // psy-1 lives on site-y; must not appear
    expect(ids).not.toContain("psy-1");
  });

  it("excludes draft posts even when the body matches", async () => {
    const posts = await searchPublishedPosts("site-search-x", "secretbodyterm");
    const ids = posts.map((p) => p.id);
    // psx-3 is a draft with secretbodyterm in body; must not appear
    expect(ids).not.toContain("psx-3");
  });

  it("returns empty array for an empty query", async () => {
    const posts = await searchPublishedPosts("site-search-x", "");
    expect(posts).toHaveLength(0);
  });

  it("returns empty array for a whitespace-only query", async () => {
    const posts = await searchPublishedPosts("site-search-x", "   ");
    expect(posts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// d. LIKE wildcard escaping
// ---------------------------------------------------------------------------

describe("d. LIKE wildcard escaping", () => {
  it("a bare % query does not match all published posts (% is treated as literal)", async () => {
    // Without escaping, LIKE '%' would match every row.
    // With escaping, LIKE '%\%%' only matches rows containing a literal %.
    // None of our seeded posts contain a literal % character.
    const posts = await searchPublishedPosts("site-search-x", "%");
    expect(posts).toHaveLength(0);
  });

  it("a bare _ query does not match single-character content (_ is treated as literal)", async () => {
    // Without escaping, LIKE '_' would match any single character.
    // With escaping, LIKE '%\_%' only matches rows containing a literal _.
    // None of our seeded posts contain a literal _ character.
    const posts = await searchPublishedPosts("site-search-x", "_");
    expect(posts).toHaveLength(0);
  });
});
