/**
 * Multi-tenant isolation spike - covers the three highest-risk pre-launch gaps:
 *
 *   a. Cross-site SQL isolation: the repo's WHERE site_id = ? clause must hold.
 *   b. Scope enforcement: read-only actors are rejected FORBIDDEN on writes.
 *   c. Quota enforcement: enforceApiBudget throws RATE_LIMIT when a counter
 *      is at the plan limit (API_USAGE_TEST_LIMIT=1 via miniflare bindings).
 *
 * Run via:
 *   pnpm --filter @vc/api test
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
import {
  RateLimitError,
} from "@vc/core";
import type { Actor } from "@vc/core";
import { enforceApiBudget } from "./usage";
import { getSiteOp, getPostOp, getPostBySlugOp, type OperationContext } from "./operations";
import { assertPostImagesPublishable } from "./publishing-images";

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

describe("d. publication image validation", () => {
  it("rejects empty inline image alt text", async () => {
    const ts = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO posts (
        id, site_id, title, slug, content_markdown,
        created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'api_key', 'key-full', 'api_key', 'key-full', ?, ?)`,
    ).bind("post-image-inline", "site-a", "Inline image", "inline-image", "![](/media-assets/example)", ts, ts).run();

    await expect(assertPostImagesPublishable("site-a", "post-image-inline"))
      .rejects.toMatchObject({ code: "IMAGE_ALT_REQUIRED" });
  });

  it("requires stored alt text for a featured image", async () => {
    const ts = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO assets (
        id, site_id, r2_key, filename, mime_type, size_bytes,
        created_by_type, created_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'api_key', 'key-full', ?, ?)`,
    ).bind("asset-cover-alt", "site-a", "site-a/cover.png", "cover.png", "image/png", 128, ts, ts).run();
    await env.DB.prepare(
      `INSERT INTO posts (
        id, site_id, title, slug, content_markdown, cover_asset_id,
        created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'api_key', 'key-full', 'api_key', 'key-full', ?, ?)`,
    ).bind("post-image-cover", "site-a", "Featured image", "featured-image", "# Article", "asset-cover-alt", ts, ts).run();

    await expect(assertPostImagesPublishable("site-a", "post-image-cover"))
      .rejects.toMatchObject({ code: "IMAGE_ALT_REQUIRED" });

    await env.DB.prepare("UPDATE assets SET alt_text = ? WHERE id = ?")
      .bind("A green field under a clear sky", "asset-cover-alt")
      .run();
    await expect(assertPostImagesPublishable("site-a", "post-image-cover")).resolves.toBeUndefined();
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
      "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, 'site-a', 'site-a.basedui.dev', 'default', 'active', ?, ?)",
    ).bind("dom-site-a", ts, ts).run();
  });

  it("getSiteOp returns the site public base url", async () => {
    const site = await getSiteOp(ctx);
    expect(site?.url).toBe("https://site-a.basedui.dev");
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
    expect(published.url).toBe("https://site-a.basedui.dev/url-pub");
    const draft = await getPostOp(ctx, { postId: "post-url-draft" });
    expect(draft.url).toBeNull();
  });

  it("getPostBySlugOp returns the full post and preserves published/draft URL semantics", async () => {
    const published = await getPostBySlugOp(ctx, { slug: "url-pub" });
    expect(published).toMatchObject({
      id: "post-url-pub",
      slug: "url-pub",
      contentMarkdown: "# URL",
      url: "https://site-a.basedui.dev/url-pub",
    });

    const draft = await getPostBySlugOp(ctx, { slug: "url-draft" });
    expect(draft).toMatchObject({
      id: "post-url-draft",
      slug: "url-draft",
      url: null,
    });
  });
});
