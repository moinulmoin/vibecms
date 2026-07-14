/**
 * PostRepository pre-conversion contract defense.
 *
 * Phase 5 of the Drizzle migration converts packages/db/src/repositories/posts.ts
 * from hand-written SQL to Drizzle. The factory `createD1PostRepository(env.DB)` and
 * the `PostRepository` interface (@vc/core) are preserved by the conversion, so this
 * suite exercises the STABLE interface through the @vc/core command layer + the repo
 * directly. It defends the behaviors that isolation.worker.test.ts does NOT cover and
 * that are most likely to silently regress in a Drizzle rewrite:
 *
 *   1. publish CAS: the free published-post cap (1 unless billing active) is enforced
 *      inside the guarded UPDATE. A 2nd publish at the cap with billing OFF is
 *      rejected (draft unchanged); with billing ON it publishes; re-publishing an
 *      already-published post is idempotent (no cap error).
 *   2. version attribution COALESCE: listPostVersions resolves actorName to
 *      user.name → api_keys.actor_name → raw created_by_id.
 *   3. slug conflict: a duplicate (site_id, slug) maps to ConflictError with the
 *      exact message "A post with this slug already exists" — this also proves the
 *      D1/Drizzle error cause-chain is mapped (the bug class found in domains).
 *   4. listPosts status × search matrix: the right subset, ordered updated_at DESC.
 *
 * IDs are file-scoped ("pr-") so this file never collides with the other suites
 * sharing the miniflare D1 instance (isolation: site-a/b/ws-iso; leaf: leaf-*; ...).
 *
 * Run via:
 *   pnpm --filter @vc/api test
 *
 * Runs inside @cloudflare/vitest-pool-workers with a real miniflare D1.
 * All migrations are applied before tests; each test uses unique IDs.
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
import { createD1PostRepository } from "@vc/db";
import {
  createPost,
  publishPost,
  BillingRequiredError,
  ConflictError,
} from "@vc/core";
import type { Actor } from "@vc/core";

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

const fullApiActor: Actor = {
  type: "api_key",
  id: "pr-key-full", // intentionally NOT the attribution api_keys row (pr-key-1)
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

// Human owner whose id matches the seeded `user` row (pr-user-1). The create-path
// writes created_by_id = actor.id, so this drives the user.name branch of the
// version-attribution COALESCE through the real write path.
const humanOwnerActor: Actor = {
  type: "human",
  id: "pr-user-1",
  name: "Ada Lovelace",
  role: "owner",
};

// Fixed epoch anchors so every list-ordering assertion is wall-clock independent.
const T0 = 1_705_000_000;

// ---------------------------------------------------------------------------
// Setup: apply migrations + seed shared fixtures once per file (shared D1)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000);

  // ---- shared workspace + sites (one per test group) ----------------------
  await env.DB.prepare(
    "INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("pr-ws", "PR Workspace", "pr-ws", ts, ts)
    .run();

  const sites = ["pr-site-cap", "pr-site-attr", "pr-site-conf", "pr-site-list"];
  for (const siteId of sites) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(siteId, "pr-ws", siteId, siteId, ts, ts)
      .run();
  }

  // ---- attribution join targets: a real `user` row + a real `api_keys` row -
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind("pr-user-1", "Ada Lovelace", "ada@pr-test.example", 1, null, ts, ts)
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, last_used_at, revoked_at, created_by_user_id, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "pr-key-1",
      "pr-site-attr",
      "Bot Key",
      "pr_bot_",
      "hash_pr_key_1_unique",
      "[]",
      "Bot Writer",
      null,
      null,
      "pr-user-1",
      ts,
      ts,
    )
    .run();

  // ---- cap test seed: one ALREADY-published post on the cap site ----------
  // This puts the cap site at the free published limit (1) from the start.
  await seedPost("pr-post-pub1", "pr-site-cap", "Published One", "pr-post-pub1", {
    status: "published",
    publishedAt: T0,
    updatedAt: T0,
  });
  // Seed version 1 for the already-published post so idempotent publish can verify expectedVersionNumber
  await env.DB.prepare(
    "INSERT INTO post_versions (" +
      "id, post_id, site_id, version_number, title, slug, content_markdown, status, " +
      "created_by_type, created_by_id, change_summary, created_at" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      "pr-post-pub1",
      "pr-site-cap",
      1,
      "Published One",
      "pr-post-pub1",
      "# seed",
      "published",
      "api_key",
      "pr-key-full",
      "seed",
      T0,
    )
    .run();

  // ---- listPosts matrix seed: controlled status + updated_at ordering -----
  await seedPost("pr-list-pub1", "pr-site-list", "Published One", "pr-list-pub1", {
    status: "published",
    publishedAt: T0,
    updatedAt: T0 + 20,
  });
  await seedPost("pr-list-pub2", "pr-site-list", "Published Two", "pr-list-pub2", {
    status: "published",
    excerpt: "gamma notes",
    publishedAt: T0 + 5,
    updatedAt: T0 + 30, // newest published -> first in DESC order
  });
  await seedPost("pr-list-draft1", "pr-site-list", "Alpha Draft", "pr-list-draft1", {
    status: "draft",
    updatedAt: T0 + 10,
  });
});

// Minimal post seed with explicit status/updated_at so list-ordering assertions
// are deterministic. Covers every NOT NULL column; leaves optionals null.
async function seedPost(
  id: string,
  siteId: string,
  title: string,
  slug: string,
  opts: { status: string; publishedAt?: number; excerpt?: string; updatedAt: number },
): Promise<void> {
  const ts = opts.updatedAt;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO posts (" +
      "id, site_id, title, slug, excerpt, content_markdown, status, published_at, " +
      "created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      siteId,
      title,
      slug,
      opts.excerpt ?? null,
      "# seed",
      opts.status,
      opts.publishedAt ?? null,
      "api_key",
      "pr-key-full",
      "api_key",
      "pr-key-full",
      ts,
      ts,
    )
    .run();
}

async function countPublished(siteId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM posts WHERE site_id = ? AND status = 'published'",
  )
    .bind(siteId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

// ---------------------------------------------------------------------------
// 1. publish — guarded free-published-post CAS cap
// ---------------------------------------------------------------------------

describe("publish — guarded free-published-post cap (CAS)", () => {
  it("rejects a 2nd publish at the free cap (1) when billing is NOT active; the draft is left untouched", async () => {
    const repo = createD1PostRepository(env.DB);
    // pr-post-pub1 is already published -> site is AT the free cap.
    const second = await createPost(repo, fullApiActor, {
      siteId: "pr-site-cap",
      title: "Cap Rejected",
      slug: "pr-cap-rejected",
      contentMarkdown: "# rejected",
    });
    expect(second.status).toBe("draft");

    // The guarded UPDATE must match 0 rows (count=1, limit=1, billing flag=0)
    // and the command must surface BillingRequiredError. Asserting the real
    // class identity (not just a name string) so a raw D1/SQLite error reddens it.
    let caught: unknown;
    try {
      await publishPost(repo, fullApiActor, {
        siteId: "pr-site-cap",
        postId: second.id,
        expectedVersionNumber: 1,
        billingStatus: "none",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BillingRequiredError);
    expect((caught as Error).message).toMatch(/more than one post/i);

    // Teeth: the rejected publish must NOT have mutated the draft.
    const stillDraft = await repo.getPost("pr-site-cap", second.id);
    expect(stillDraft?.status).toBe("draft");
    // And the cap site still has exactly one published post.
    expect(await countPublished("pr-site-cap")).toBe(1);
  });

  it("publishes the 2nd post once billing is active (cap bypassed)", async () => {
    const repo = createD1PostRepository(env.DB);
    const second = await createPost(repo, fullApiActor, {
      siteId: "pr-site-cap",
      title: "Cap Allowed",
      slug: "pr-cap-allowed",
      contentMarkdown: "# allowed",
    });

    const published = await publishPost(repo, fullApiActor, {
      siteId: "pr-site-cap",
      postId: second.id,
      expectedVersionNumber: 1,
      billingStatus: "active",
    });

    expect(published.status).toBe("published");
    expect(published.id).toBe(second.id);
    // Billing-active bypassed the cap -> now two published posts.
    expect(await countPublished("pr-site-cap")).toBe(2);
  });

  it("rejects publish when expectedVersionNumber is stale (intervening edit)", async () => {
    const repo = createD1PostRepository(env.DB);
    const post = await createPost(repo, fullApiActor, {
      siteId: "pr-site-cap",
      title: "Version Conflict Test",
      slug: "pr-version-conflict",
      contentMarkdown: "# original",
    });
    expect(post.status).toBe("draft");

    // Approve version 1
    const versions = await repo.listPostVersions("pr-site-cap", post.id);
    const approvedVersion = versions[0];
    expect(approvedVersion.versionNumber).toBe(1);

    // Edit the post (creates version 2)
    await repo.updatePostWithHistory("pr-site-cap", post.id, { title: "Updated Title" }, fullApiActor, {
      changeSummary: "Updated title",
      activityAction: "post.updated",
      activitySummary: "Updated post title",
    });

    // Try to publish with stale expectedVersionNumber (1 instead of 2)
    let caught: unknown;
    try {
      await publishPost(repo, fullApiActor, {
        siteId: "pr-site-cap",
        postId: post.id,
        expectedVersionNumber: 1, // Stale - should be 2
        billingStatus: "active",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as Error).message).toMatch(/changed since approval/i);

    // The post must still be draft (status unchanged)
    const stillDraft = await repo.getPost("pr-site-cap", post.id);
    expect(stillDraft?.status).toBe("draft");
  });

  it("re-publishing an already-published post is idempotent (no cap error even with billing off, at cap)", async () => {
    const repo = createD1PostRepository(env.DB);
    // pr-post-pub1 is already published; re-publishing must short-circuit (early
    // return) BEFORE the cap guard, so it must NOT throw even though billing is
    // off and the site is at/over the free cap.
    const republished = await publishPost(repo, fullApiActor, {
      siteId: "pr-site-cap",
      postId: "pr-post-pub1",
      expectedVersionNumber: 1,
      billingStatus: "none",
    });

    expect(republished.status).toBe("published");
    expect(republished.id).toBe("pr-post-pub1");
  });

  it("rejects idempotent publish when expectedVersionNumber is stale for already-published post", async () => {
    const repo = createD1PostRepository(env.DB);
    // pr-post-pub1 is already published with version 1
    // Try to publish with expectedVersionNumber = 999 (stale)
    let caught: unknown;
    try {
      await publishPost(repo, fullApiActor, {
        siteId: "pr-site-cap",
        postId: "pr-post-pub1",
        expectedVersionNumber: 999, // Stale - should be 1
        billingStatus: "none",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as Error).message).toMatch(/changed since approval/i);
  });
});

// ---------------------------------------------------------------------------
// 2. listPostVersions — actorName COALESCE(user.name, api_keys.actor_name, created_by_id)
// ---------------------------------------------------------------------------

describe("listPostVersions — actorName attribution coalesce", () => {
  it("resolves a human-authored version (created_by_id = user.id) to the user's name", async () => {
    const repo = createD1PostRepository(env.DB);
    // createPost writes version 1 with created_by_id = humanOwnerActor.id (pr-user-1),
    // which joins to the seeded user row.
    const post = await createPost(repo, humanOwnerActor, {
      siteId: "pr-site-attr",
      title: "Attr Human",
      slug: "pr-attr-human",
      contentMarkdown: "# human",
    });

    const versions = await repo.listPostVersions("pr-site-attr", post.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].actorName).toBe("Ada Lovelace"); // user.name branch
    expect(versions[0].actorType).toBe("human");
  });

  it("resolves an api-key version to api_keys.actor_name and an unknown id to the raw id", async () => {
    const repo = createD1PostRepository(env.DB);
    const ts = Math.floor(Date.now() / 1000);
    const post = await createPost(repo, humanOwnerActor, {
      siteId: "pr-site-attr",
      title: "Attr Coalesce",
      slug: "pr-attr-coalesce",
      contentMarkdown: "# coalesce",
    });

    // Version 2 authored by the seeded api_keys row (pr-key-1 -> actor_name "Bot Writer").
    await env.DB.prepare(
      "INSERT INTO post_versions (" +
        "id, post_id, site_id, version_number, title, slug, content_markdown, status, " +
        "created_by_type, created_by_id, change_summary, created_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        post.id,
        "pr-site-attr",
        2,
        "Attr Coalesce",
        "pr-attr-coalesce",
        "# coalesce",
        "draft",
        "api_key",
        "pr-key-1",
        "api-key edit",
        ts,
      )
      .run();

    // Version 3 authored by an id with NO matching user or api_key row -> raw id fallback.
    await env.DB.prepare(
      "INSERT INTO post_versions (" +
        "id, post_id, site_id, version_number, title, slug, content_markdown, status, " +
        "created_by_type, created_by_id, change_summary, created_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        post.id,
        "pr-site-attr",
        3,
        "Attr Coalesce",
        "pr-attr-coalesce",
        "# coalesce",
        "draft",
        "api_key",
        "pr-unknown-999",
        "ghost edit",
        ts,
      )
      .run();

    const versions = await repo.listPostVersions("pr-site-attr", post.id);
    const byNumber = new Map(versions.map((v) => [v.versionNumber, v]));
    expect(versions.map((v) => v.versionNumber)).toEqual([3, 2, 1]); // DESC order

    expect(byNumber.get(1)?.actorName).toBe("Ada Lovelace"); // user.name
    expect(byNumber.get(2)?.actorName).toBe("Bot Writer"); // api_keys.actor_name
    expect(byNumber.get(3)?.actorName).toBe("pr-unknown-999"); // raw created_by_id fallback
  });
});

// ---------------------------------------------------------------------------
// 3. createPost — slug conflict maps to ConflictError (cause-chain intact)
// ---------------------------------------------------------------------------

describe("createPost — slug conflict", () => {
  it("rejects a duplicate slug on the same site with the exact ConflictError message", async () => {
    const repo = createD1PostRepository(env.DB);
    await createPost(repo, fullApiActor, {
      siteId: "pr-site-conf",
      title: "First Slug",
      slug: "pr-dup-slug",
      contentMarkdown: "# first",
    });

    // A Drizzle rewrite that fails to map the UNIQUE(site_id, slug) violation to
    // ConflictError (the domains bug class) would surface a raw SQLite error here.
    // A Drizzle rewrite that fails to map the UNIQUE(site_id, slug) violation to
    // ConflictError (the domains bug class) would surface a raw SQLite error
    // here instead — assert the real class identity AND the exact message.
    let caught: unknown;
    try {
      await createPost(repo, fullApiActor, {
        siteId: "pr-site-conf",
        title: "Second Slug",
        slug: "pr-dup-slug",
        contentMarkdown: "# second",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as Error).message).toBe("A post with this slug already exists");
  });

  it("allows the same slug on a different site (uniqueness is per-site, not global)", async () => {
    const repo = createD1PostRepository(env.DB);
    // pr-dup-slug exists on pr-site-conf; creating it on pr-site-attr must succeed.
    const created = await createPost(repo, fullApiActor, {
      siteId: "pr-site-attr",
      title: "Other Site Same Slug",
      slug: "pr-dup-slug",
      contentMarkdown: "# other",
    });

    expect(created.slug).toBe("pr-dup-slug");
    expect(created.siteId).toBe("pr-site-attr");
  });
});

// ---------------------------------------------------------------------------
// 4. listPosts — status × search matrix, ordered updated_at DESC
// ---------------------------------------------------------------------------

describe("listPosts — status × search filter matrix", () => {
  it("status filter returns only the matching posts, ordered updated_at DESC", async () => {
    const repo = createD1PostRepository(env.DB);
    const posts = await repo.listPosts({
      siteId: "pr-site-list",
      status: "published",
      limit: 100,
      offset: 0,
    });

    // pub2 (updated_at T0+30) before pub1 (T0+30) -- newest first.
    expect(posts.map((p) => p.slug)).toEqual(["pr-list-pub2", "pr-list-pub1"]);
  });

  it("status + search narrows to LIKE %term% across title/slug/excerpt", async () => {
    const repo = createD1PostRepository(env.DB);
    const posts = await repo.listPosts({
      siteId: "pr-site-list",
      status: "published",
      search: "gamma",
      limit: 100,
      offset: 0,
    });

    // Only pub2 has "gamma" (in its excerpt).
    expect(posts.map((p) => p.slug)).toEqual(["pr-list-pub2"]);
  });

  it("search without a status matches across all statuses (case-insensitive LIKE)", async () => {
    const repo = createD1PostRepository(env.DB);
    const posts = await repo.listPosts({
      siteId: "pr-site-list",
      search: "alpha",
      limit: 100,
      offset: 0,
    });

    // Only draft1's title contains "Alpha" (matched case-insensitively by LIKE %alpha%).
    expect(posts.map((p) => p.slug)).toEqual(["pr-list-draft1"]);
  });
});
