/**
 * Multi-tenant isolation spike - covers the three highest-risk pre-launch gaps:
 *
 *   a. Cross-site SQL isolation: the repo's WHERE site_id = ? clause must hold.
 *   b. Scope enforcement: read-only actors are rejected FORBIDDEN on writes.
 *   c. Quota enforcement: enforceApiBudget throws RATE_LIMIT when a counter
 *      is at the plan limit (API_USAGE_TEST_LIMIT=1 via miniflare bindings).
 *
 * Run via:
 *   pnpm --filter @vc/web-next test:isolation
 *
 * Runs inside @cloudflare/vitest-pool-workers with a real miniflare D1.
 * All migrations are applied before tests; each test uses unique IDs.
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />
// Augment ProvidedContext so inject('migrations') type-checks correctly.
declare module "vitest" {
  interface ProvidedContext {
    migrations: import("cloudflare:test").D1Migration[];
  }
}

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import { createD1PostRepository } from "@vc/db";
import {
  createPost,
  getPost,
  listPosts,
  updatePost,
  publishPost,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
} from "@vc/core";
import type { Actor } from "@vc/core";
import { enforceApiBudget } from "../server/usage";

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

const fullActor: Actor = {
  type: "api_key",
  id: "key-full",
  name: "Full Access Key",
  scopes: [
    "sites:read",
    "posts:read",
    "posts:create",
    "posts:update",
    "posts:publish",
    "posts:archive",
    "assets:write",
    "activity:read",
  ],
};

const readOnlyActor: Actor = {
  type: "api_key",
  id: "key-ro",
  name: "Read Only Key",
  scopes: ["sites:read", "posts:read", "activity:read"],
};

// ---------------------------------------------------------------------------
// Setup: apply migrations + seed test data once per file (shared D1)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // migrations is provided by isolation-global-setup.ts (runs in Node.js).
  // The array is serialised across the pool boundary via vitest's inject.
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000);

  // ---- cross-site isolation seed (test a) --------------------------------
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("ws-iso", "Isolation Workspace", "ws-iso", ts, ts)
    .run();

  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind("site-a", "ws-iso", "Site A", "site-a", ts, ts)
    .run();

  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind("site-b", "ws-iso", "Site B", "site-b", ts, ts)
    .run();

  // Insert posts directly - bypasses command layer for simpler seeding.
  // The isolation assertions only need the rows to exist; no version history required.
  const postCols =
    "id, site_id, title, slug, content_markdown, " +
    "created_by_type, created_by_id, updated_by_type, updated_by_id, " +
    "created_at, updated_at";

  await env.DB.prepare(
    `INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind("post-a", "site-a", "Post A", "post-a", "# Post A", "api_key", "key-full", "api_key", "key-full", ts, ts)
    .run();

  await env.DB.prepare(
    `INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind("post-b", "site-b", "Post B", "post-b", "# Post B", "api_key", "key-full", "api_key", "key-full", ts, ts)
    .run();

  // ---- quota enforcement seed (test c) ------------------------------------
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("ws-quota", "Quota Workspace", "ws-quota", ts, ts)
    .run();

  // Seed the workspace DAY calls counter at value = limit (1, from
  // API_USAGE_TEST_LIMIT=1). enforceApiBudget checks day counter third;
  // using the day period (YYYY-MM-DD) avoids minute-boundary flakiness.
  const today = new Date().toISOString().slice(0, 10);
  const dayCounterId = `workspace:ws-quota:calls:${today}`;

  await env.DB.prepare(
    "INSERT INTO usage_counters (id, workspace_id, site_id, period, metric, value, created_at, updated_at) VALUES (?, ?, null, ?, ?, 1, ?, ?)",
  )
    .bind(dayCounterId, "ws-quota", today, "calls", ts, ts)
    .run();
});

// ---------------------------------------------------------------------------
// a. Cross-site isolation
// ---------------------------------------------------------------------------

describe("a. cross-site SQL isolation", () => {
  it("getPost: site-A actor cannot retrieve site-B post (WHERE clause holds)", async () => {
    const repo = createD1PostRepository(env.DB);
    // post-b lives in site-b; querying with site-a as the siteId must return null
    // because the SQL is: WHERE site_id = 'site-a' AND id = 'post-b'
    await expect(getPost(repo, fullActor, "site-a", "post-b")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listPosts: listing site-A posts must not leak site-B post", async () => {
    const repo = createD1PostRepository(env.DB);
    const posts = await listPosts(repo, fullActor, {
      siteId: "site-a",
      limit: 100,
      offset: 0,
    });
    const ids = posts.map((p) => p.id);
    expect(ids).toContain("post-a"); // sanity: site-A's own post is visible
    expect(ids).not.toContain("post-b"); // site-B post must NOT appear
  });

  it("updatePost: cross-site update attempt returns NOT_FOUND, not a silent success", async () => {
    const repo = createD1PostRepository(env.DB);
    // Attempting to update post-b while scoped to site-a: the repo fetches
    // with WHERE site_id='site-a' AND id='post-b', finds nothing, and the
    // command throws NotFoundError. The post-b row must remain untouched.
    await expect(
      updatePost(repo, fullActor, {
        siteId: "site-a",
        postId: "post-b",
        title: "Hijacked by site-a actor",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// b. Scope enforcement
// ---------------------------------------------------------------------------

describe("b. scope enforcement", () => {
  // requireScope fires before any DB access, so the real repo is passed but
  // will never be queried for these writes.

  it("read-only actor is FORBIDDEN from createPost", async () => {
    const repo = createD1PostRepository(env.DB);
    await expect(
      createPost(repo, readOnlyActor, {
        siteId: "site-a",
        title: "Unauthorized Post",
        slug: "unauthorized-post",
        contentMarkdown: "should not reach DB",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("read-only actor is FORBIDDEN from updatePost", async () => {
    const repo = createD1PostRepository(env.DB);
    await expect(
      updatePost(repo, readOnlyActor, {
        siteId: "site-a",
        postId: "post-a",
        title: "Hijacked Title",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("read-only actor is FORBIDDEN from publishPost", async () => {
    const repo = createD1PostRepository(env.DB);
    await expect(
      publishPost(repo, readOnlyActor, {
        siteId: "site-a",
        postId: "post-a",
        billingStatus: "none",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// c. Quota enforcement
// ---------------------------------------------------------------------------

describe("c. quota enforcement", () => {
  it("enforceApiBudget throws RATE_LIMIT when workspace day counter is at limit", async () => {
    // The miniflare binding API_USAGE_TEST_LIMIT=1 makes planFor() return
    // limit=1 for all periods (calls.minute, calls.day, calls.month, etc.).
    // The beforeAll seeded workspace:ws-quota:calls:<today> at value=1.
    //
    // enforceApiBudget for kind='read' checks counters in this order:
    //   1. workspace minute counter (unseeded, value=0) -> 0 < 1, pass
    //   2. token minute counter     (unseeded, value=0) -> 0 < 1, pass
    //   3. workspace day counter    (seeded,   value=1) -> 1 >= 1, throw RateLimitError
    //
    // SELF_HOSTED=false (wrangler.jsonc) so the budget path is active.
    // No billing_customers row for ws-quota so getBillingStatus returns 'none'.
    await expect(
      enforceApiBudget({
        workspaceId: "ws-quota",
        siteId: "site-quota-dummy", // not inserted; no FK check needed for reads
        tokenId: "tok-quota",
        kind: "read",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
