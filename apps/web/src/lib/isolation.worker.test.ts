/**
 * Multi-tenant isolation spike - covers the three highest-risk pre-launch gaps:
 *
 *   a. Cross-site SQL isolation: the repo's WHERE site_id = ? clause must hold.
 *   b. Scope enforcement: read-only actors are rejected FORBIDDEN on writes.
 *   c. Quota enforcement: enforceApiBudget throws RATE_LIMIT when a counter
 *      is at the plan limit (API_USAGE_TEST_LIMIT=1 via miniflare bindings).
 *
 * Run via:
 *   pnpm --filter @vc/web test:isolation
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
import { createD1DomainRepository, createD1PostRepository } from "@vc/db";
import {
  createPost,
  getPost,
  getPostVersion,
  listPosts,
  updatePost,
  publishPost,
  restorePostVersion,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  addCustomDomain,
  listCustomDomains,
  removeCustomDomain,
  BillingRequiredError,
  ConflictError,
  ValidationError,
} from "@vc/core";
import type { Actor } from "@vc/core";
import { enforceApiBudget } from "../server/usage";
import { resolveSite } from "../server/public-blog-data";
import { loadPublicPostByHost, handlePublicPostByHostGet } from "../server/public-blog";
import { getSiteOp, getPostOp, type OperationContext } from "../server/operations";

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

// ---------------------------------------------------------------------------
// d. coverAssetId + canonicalUrl persistence (typed fields + version snapshot)
// ---------------------------------------------------------------------------

describe("d. coverAssetId + canonicalUrl persistence", () => {
  it("createPost persists coverAssetId + canonicalUrl on the post row and the version snapshot", async () => {
    const repo = createD1PostRepository(env.DB);
    const created = await createPost(repo, fullActor, {
      siteId: "site-a",
      title: "Fields Post",
      slug: "fields-post",
      contentMarkdown: "# Fields",
      coverAssetId: "asset-cover-1",
      canonicalUrl: "https://example.com/canonical",
    });
    expect(created.coverAssetId).toBe("asset-cover-1");
    expect(created.canonicalUrl).toBe("https://example.com/canonical");

    const fetched = await getPost(repo, fullActor, "site-a", created.id);
    expect(fetched.coverAssetId).toBe("asset-cover-1");
    expect(fetched.canonicalUrl).toBe("https://example.com/canonical");

    // The version snapshot must capture both - this is the new write path the API relies on.
    const versionRow = await env.DB.prepare(
      "SELECT canonical_url, cover_asset_id FROM post_versions WHERE post_id = ? ORDER BY version_number DESC LIMIT 1",
    )
      .bind(created.id)
      .first<{ canonical_url: string | null; cover_asset_id: string | null }>();
    expect(versionRow?.canonical_url).toBe("https://example.com/canonical");
    expect(versionRow?.cover_asset_id).toBe("asset-cover-1");
  });

  it("updatePost preserves canonicalUrl when omitted and clears it on explicit null", async () => {
    const repo = createD1PostRepository(env.DB);
    const created = await createPost(repo, fullActor, {
      siteId: "site-a",
      title: "Patch Fields Post",
      slug: "patch-fields-post",
      contentMarkdown: "# Patch",
      canonicalUrl: "https://example.com/keep",
    });

    const preserved = await updatePost(repo, fullActor, {
      siteId: "site-a",
      postId: created.id,
      title: "Patch Fields Post v2",
    });
    expect(preserved.canonicalUrl).toBe("https://example.com/keep");

    const cleared = await updatePost(repo, fullActor, {
      siteId: "site-a",
      postId: created.id,
      canonicalUrl: null,
    });
    expect(cleared.canonicalUrl).toBeNull();
  });
  it("restorePostVersion reverts canonicalUrl from the version snapshot", async () => {
    const repo = createD1PostRepository(env.DB);
    const created = await createPost(repo, fullActor, {
      siteId: "site-a",
      title: "Canonical Restore Post",
      slug: "canonical-restore-post",
      contentMarkdown: "# Restore",
      canonicalUrl: "https://a.example/one",
    });

    // updatePost snapshots v2 with the NEW value; v1 (create-time) keeps the OLD value.
    await updatePost(repo, fullActor, {
      siteId: "site-a",
      postId: created.id,
      canonicalUrl: "https://b.example/two",
    });

    // The live post now carries the NEW value.
    const before = await getPost(repo, fullActor, "site-a", created.id);
    expect(before.canonicalUrl).toBe("https://b.example/two");

    // Restoring to v1 must revert canonicalUrl back to the OLD value.
    const restored = await restorePostVersion(repo, fullActor, {
      siteId: "site-a",
      postId: created.id,
      versionNumber: 1,
    });
    expect(restored.canonicalUrl).toBe("https://a.example/one");

    // The version snapshot read-back must also carry the OLD canonicalUrl.
    const version = await getPostVersion(repo, fullActor, {
      siteId: "site-a",
      postId: created.id,
      versionNumber: 1,
    });
    expect(version?.canonicalUrl).toBe("https://a.example/one");
  });
});

// ---------------------------------------------------------------------------
// e. custom domains (validation, owner+paid gating, stale reclaim, host serving)
// ---------------------------------------------------------------------------

describe("e. custom domains", () => {
  const ENV = { appHost: "app.vibecms.dev", platformZone: "vibecms.dev" };

  it("addCustomDomain inserts a pending custom row for a paid owner and normalizes the hostname", async () => {
    const repo = createD1DomainRepository(env.DB);
    const { record, reclaimedCfHostnameId } = await addCustomDomain(repo, {
      siteId: "site-a",
      hostname: "Blog.Example.com",
      isOwner: true,
      isPaid: true,
      ...ENV,
    });
    expect(record.type).toBe("custom");
    expect(record.status).toBe("pending");
    expect(record.hostname).toBe("blog.example.com");
    expect(reclaimedCfHostnameId).toBeNull();
    const list = await listCustomDomains(repo, "site-a");
    expect(list.some((d) => d.hostname === "blog.example.com")).toBe(true);
  });

  it("gates add behind owner + paid and rejects platform hostnames", async () => {
    const repo = createD1DomainRepository(env.DB);
    await expect(
      addCustomDomain(repo, { siteId: "site-a", hostname: "x1.example.com", isOwner: false, isPaid: true, ...ENV }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addCustomDomain(repo, { siteId: "site-a", hostname: "x2.example.com", isOwner: true, isPaid: false, ...ENV }),
    ).rejects.toBeInstanceOf(BillingRequiredError);
    await expect(
      addCustomDomain(repo, { siteId: "site-a", hostname: "evil.vibecms.dev", isOwner: true, isPaid: true, ...ENV }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a hostname freshly connected to another site", async () => {
    const repo = createD1DomainRepository(env.DB);
    await addCustomDomain(repo, { siteId: "site-a", hostname: "shared.example.com", isOwner: true, isPaid: true, ...ENV });
    await expect(
      addCustomDomain(repo, { siteId: "site-b", hostname: "shared.example.com", isOwner: true, isPaid: true, ...ENV }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets the real owner reclaim a stale never-verified squatter row, but not a fresh one", async () => {
    const repo = createD1DomainRepository(env.DB);
    const staleTtlSeconds = 72 * 60 * 60;
    const claimedAt = 1_000_000_000;
    // site-a squats reclaim.example.com but never verifies it.
    await env.DB.prepare(
      "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'pending', ?, ?)",
    )
      .bind("dom-stale", "site-a", "reclaim.example.com", claimedAt, claimedAt)
      .run();
    // Inside the TTL window: not reclaimable, the squatter still has time to verify.
    await expect(
      addCustomDomain(repo, {
        siteId: "site-b",
        hostname: "reclaim.example.com",
        isOwner: true,
        isPaid: true,
        ...ENV,
        now: claimedAt + 60,
        staleTtlSeconds,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // After the TTL elapses, the real owner reclaims it.
    const { record } = await addCustomDomain(repo, {
      siteId: "site-b",
      hostname: "reclaim.example.com",
      isOwner: true,
      isPaid: true,
      ...ENV,
      now: claimedAt + staleTtlSeconds + 1,
      staleTtlSeconds,
    });
    expect(record.siteId).toBe("site-b");
    expect((await repo.getByHostname("reclaim.example.com"))?.siteId).toBe("site-b");
  });

  it("removeCustomDomain deletes only the owner's own custom domain", async () => {
    const repo = createD1DomainRepository(env.DB);
    const { record } = await addCustomDomain(repo, { siteId: "site-a", hostname: "remove.example.com", isOwner: true, isPaid: true, ...ENV });
    await expect(removeCustomDomain(repo, { siteId: "site-a", domainId: record.id, isOwner: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeCustomDomain(repo, { siteId: "site-b", domainId: record.id, isOwner: true })).rejects.toBeInstanceOf(NotFoundError);
    await removeCustomDomain(repo, { siteId: "site-a", domainId: record.id, isOwner: true });
    expect((await listCustomDomains(repo, "site-a")).some((d) => d.hostname === "remove.example.com")).toBe(false);
  });

  it("resolveSite serves an active custom domain but never a pending or failed one", async () => {
    const ts = 1_700_000_000;
    await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("ws-dom", "Dom WS", "ws-dom", ts, ts).run();
    await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind("site-dom", "ws-dom", "Dom Site", "site-dom", ts, ts).run();
    await env.DB.prepare("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)").bind("bc-dom", "ws-dom", ts, ts).run();
    await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, 'site-dom', ?, 'custom', 'active', ?, ?)").bind("dom-active", "active.example.com", ts, ts).run();
    await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, 'site-dom', ?, 'custom', 'pending', ?, ?)").bind("dom-pending", "pending.example.com", ts, ts).run();

    const served = await resolveSite(new Request("https://active.example.com/", { headers: { host: "active.example.com" } }));
    expect(served?.id).toBe("site-dom");
    const notServed = await resolveSite(new Request("https://pending.example.com/", { headers: { host: "pending.example.com" } }));
    expect(notServed).toBeNull();
  });

  it("surfaces a reclaimed squatter's Cloudflare hostname id so the caller can tear it down", async () => {
    const repo = createD1DomainRepository(env.DB);
    const staleTtlSeconds = 72 * 60 * 60;
    const claimedAt = 1_000_000_100;
    // site-a squats with a provisioned-but-never-verified CF hostname, then abandons it.
    await env.DB.prepare(
      "INSERT INTO domains (id, site_id, hostname, type, status, cloudflare_custom_hostname_id, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'pending', ?, ?, ?)",
    )
      .bind("dom-cf-stale", "site-a", "cfreclaim.example.com", "cf-stale-xyz", claimedAt, claimedAt)
      .run();
    // The real owner reclaims after the TTL; the stale row's CF id must come back so the caller tears it down.
    const { record, reclaimedCfHostnameId } = await addCustomDomain(repo, {
      siteId: "site-b",
      hostname: "cfreclaim.example.com",
      isOwner: true,
      isPaid: true,
      ...ENV,
      now: claimedAt + staleTtlSeconds + 1,
      staleTtlSeconds,
    });
    expect(record.siteId).toBe("site-b");
    expect(reclaimedCfHostnameId).toBe("cf-stale-xyz");
  });

  it("resolveSite serves an active customer app.* domain but still rejects the platform app subdomain", async () => {
    const ts = 1_700_000_100;
    await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("ws-appsub", "AppSub WS", "ws-appsub", ts, ts).run();
    await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind("site-appsub", "ws-appsub", "AppSub Site", "site-appsub", ts, ts).run();
    await env.DB.prepare("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)").bind("bc-appsub", "ws-appsub", ts, ts).run();
    // A customer-owned app.* host is a legitimate custom domain and must serve once active.
    await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, 'site-appsub', ?, 'custom', 'active', ?, ?)").bind("dom-appsub", "app.customer.com", ts, ts).run();
    // The platform's own app subdomain (app.<PUBLIC_BLOG_DOMAIN>) must never resolve, even with an active row.
    await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, 'site-appsub', ?, 'custom', 'active', ?, ?)").bind("dom-platapp", "app.dev.vibecms.dev", ts, ts).run();

    const served = await resolveSite(new Request("https://app.customer.com/", { headers: { host: "app.customer.com" } }));
    expect(served?.id).toBe("site-appsub");
    const platformApp = await resolveSite(new Request("https://app.dev.vibecms.dev/", { headers: { host: "app.dev.vibecms.dev" } }));
    expect(platformApp).toBeNull();
  });

  it("never serves a reserved root slug as a post on a custom host, including the .md and markdown paths", async () => {
    const ts = 1_700_000_200;
    await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("ws-reserved", "Reserved WS", "ws-reserved", ts, ts).run();
    await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind("site-reserved", "ws-reserved", "Reserved Site", "site-reserved", ts, ts).run();
    await env.DB.prepare("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)").bind("bc-reserved", "ws-reserved", ts, ts).run();
    await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, 'site-reserved', ?, 'custom', 'active', ?, ?)").bind("dom-reserved", "posts.acmecorp.com", ts, ts).run();
    const postCols = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
    // A published post whose slug collides with a reserved root, plus a normal one.
    await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("post-api", "site-reserved", "Api", "api", "# Api", "published", ts, "api_key", "key-full", "api_key", "key-full", ts, ts)
      .run();
    await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("post-hello", "site-reserved", "Hello", "hello", "# Hello", "published", ts, "api_key", "key-full", "api_key", "key-full", ts, ts)
      .run();

    const headers = { host: "posts.acmecorp.com" };
    // Reserved slug must not resolve as a post even though a post slugged "api" exists.
    expect(await loadPublicPostByHost(new Request("https://posts.acmecorp.com/api", { headers }), "api")).toBeNull();
    // The .md variant must also be guarded (strip then check), closing the /api.md bypass.
    expect(await loadPublicPostByHost(new Request("https://posts.acmecorp.com/api.md", { headers }), "api.md")).toBeNull();
    // A normal post still resolves, so the guard does not over-block.
    const real = await loadPublicPostByHost(new Request("https://posts.acmecorp.com/hello", { headers }), "hello");
    expect(real?.post.slug).toBe("hello");
    // The markdown GET path must not serve a reserved slug either.
    const md = await handlePublicPostByHostGet(new Request("https://posts.acmecorp.com/api?format=md", { headers }), "api");
    expect(md).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// f. public url resolution in op DTOs (test env is subdomain mode, like prod)
// ---------------------------------------------------------------------------

describe("f. public url in op DTOs", () => {
  const ctx: OperationContext = { actor: fullActor, siteId: "site-a", workspaceId: "ws-iso", tokenId: "key-full" };

  beforeAll(async () => {
    const ts = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, 'site-a', 'site-a.dev.vibecms.dev', 'default', 'active', ?, ?)",
    ).bind("dom-site-a", ts, ts).run();
  });

  it("getSiteOp returns the site public base url", async () => {
    const site = await getSiteOp(ctx);
    expect(site?.url).toBe("https://site-a.dev.vibecms.dev");
  });

  it("getPostOp composes the url for a published post and returns null for a draft", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const cols = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
    await env.DB.prepare(`INSERT INTO posts (${cols}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'key-full', 'api_key', 'key-full', ?, ?)`)
      .bind("post-url-pub", "site-a", "URL Pub", "url-pub", "# URL", ts, ts, ts)
      .run();
    await env.DB.prepare(`INSERT INTO posts (${cols}) VALUES (?, ?, ?, ?, ?, 'draft', NULL, 'api_key', 'key-full', 'api_key', 'key-full', ?, ?)`)
      .bind("post-url-draft", "site-a", "URL Draft", "url-draft", "# D", ts, ts)
      .run();
    const published = await getPostOp(ctx, { postId: "post-url-pub" });
    expect(published.url).toBe("https://site-a.dev.vibecms.dev/url-pub");
    const draft = await getPostOp(ctx, { postId: "post-url-draft" });
    expect(draft.url).toBeNull();
  });
});
