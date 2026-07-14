/**
 * Leaf-repository behavioral contracts under real miniflare D1.
 *
 * Covers the repositories converted from raw SQL to Drizzle in the migration's
 * first phase (assets, subscribers, the shared activity repo) plus two genuine
 * gaps in the domains repo's OWN contract that isolation.worker.test.ts only
 * reaches through the command layer (addCustomDomain pre-checks
 * getByHostname, so repo.insert's UNIQUE -> ConflictError mapping and
 * reclaimStale's numeric/boundary return are never directly asserted there).
 *
 * Every assertion targets an observable contract: cross-site SQL isolation,
 * idempotent-conflict boolean semantics, newest-first ordering, and
 * delete/reclaim scoping. IDs are file-scoped ("leaf-*") so this file never
 * collides with the other suites sharing the miniflare D1 instance.
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
import {
  createD1AssetRepository,
  createD1SubscriberRepository,
  createActivityRepository,
  createD1DomainRepository,
} from "@vc/db";
import { ConflictError, type Actor } from "@vc/core";

const WORKSPACE_ID = "ws-leaf";
const ACTOR: Actor = { type: "human", id: "leaf-user", name: "Leaf User", role: "owner" };

// Fixed epoch-second anchors for deterministic ordering. The repos stamp
// Math.floor(Date.now()/1000) (second granularity, which would tie and make
// newest-first non-deterministic), so ordering assertions seed explicit values.
const T_OLD = 1_600_000_000;
const T_BASE = 1_700_000_000;

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(WORKSPACE_ID, "Leaf Workspace", WORKSPACE_ID, ts, ts)
    .run();

  // Each behavioral assertion below is scoped to a dedicated site so that no
  // test depends on rows another test created (full within-file independence).
  const sites = [
    "site-leaf-a", // create / get / update / delete assets
    "site-leaf-b", // wrong-site scoping target
    "site-leaf-list-a", // listAssets ordering
    "site-leaf-list-b", // listAssets excluded-other-site
    "site-leaf-cover", // isAssetReferencedAsCover
    "site-leaf-sub-a", // subscribers
    "site-leaf-sub-b",
    "site-leaf-act-a", // activity create
    "site-leaf-act-list-a", // activity listBySite ordering
    "site-leaf-act-list-b", // activity excluded-other-site
    "site-leaf-dom-a", // domains conflict + reclaim
    "site-leaf-dom-b", // domains conflict other-site
  ];
  for (const id of sites) {
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, WORKSPACE_ID, id, id, ts, ts)
      .run();
  }
});

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

describe("AssetRepository (Drizzle)", () => {
  it("createAsset persists every field and getAsset returns it; getAsset is site-scoped", async () => {
    const repo = createD1AssetRepository(env.DB);
    const created = await repo.createAsset(
      {
        id: "leaf-create-1",
        siteId: "site-leaf-a",
        r2Key: "uploads/leaf/create-1.png",
        filename: "cat.png",
        mimeType: "image/png",
        sizeBytes: 4096,
        width: 800,
        height: 600,
        altText: "A cat",
      },
      ACTOR,
    );
    expect(created).toMatchObject({
      id: "leaf-create-1",
      siteId: "site-leaf-a",
      r2Key: "uploads/leaf/create-1.png",
      filename: "cat.png",
      mimeType: "image/png",
      sizeBytes: 4096,
      width: 800,
      height: 600,
      altText: "A cat",
    });
    expect(typeof created.createdAt).toBe("number");
    expect(typeof created.updatedAt).toBe("number");

    const fetched = await repo.getAsset("site-leaf-a", "leaf-create-1");
    expect(fetched).toMatchObject({
      id: "leaf-create-1",
      r2Key: "uploads/leaf/create-1.png",
      filename: "cat.png",
      mimeType: "image/png",
      sizeBytes: 4096,
      width: 800,
      height: 600,
      altText: "A cat",
    });

    // Site-scoping: the same asset id is invisible from another site, and an
    // unknown id is null. Both exercise the WHERE site_id = ? AND id = ? clause.
    expect(await repo.getAsset("site-leaf-b", "leaf-create-1")).toBeNull();
    expect(await repo.getAsset("site-leaf-a", "leaf-create-missing")).toBeNull();
  });

  it("listAssets returns the site's assets newest-first and excludes another site's assets", async () => {
    const repo = createD1AssetRepository(env.DB);
    const cols =
      "id, site_id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, " +
      "created_by_type, created_by_id, created_at, updated_at";
    await env.DB.prepare(`INSERT INTO assets (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        "leaf-list-old",
        "site-leaf-list-a",
        "uploads/leaf/list-old.png",
        "old.png",
        "image/png",
        10,
        1,
        1,
        null,
        "human",
        "leaf-user",
        T_BASE,
        T_BASE,
      )
      .run();
    await env.DB.prepare(`INSERT INTO assets (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        "leaf-list-new",
        "site-leaf-list-a",
        "uploads/leaf/list-new.png",
        "new.png",
        "image/png",
        20,
        2,
        2,
        null,
        "human",
        "leaf-user",
        T_BASE + 100,
        T_BASE + 100,
      )
      .run();
    // Different site, timestamp between the two above — must never appear in site-a's list.
    await env.DB.prepare(`INSERT INTO assets (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        "leaf-list-other",
        "site-leaf-list-b",
        "uploads/leaf/list-other.png",
        "other.png",
        "image/png",
        30,
        3,
        3,
        null,
        "human",
        "leaf-user",
        T_BASE + 50,
        T_BASE + 50,
      )
      .run();

    const list = await repo.listAssets("site-leaf-list-a");
    expect(list.map((a) => a.id)).toEqual(["leaf-list-new", "leaf-list-old"]);
    expect(list.some((a) => a.id === "leaf-list-other")).toBe(false);
  });

  it("updateAssetAltText sets the value, clears it on null, and is a no-op for another site", async () => {
    const repo = createD1AssetRepository(env.DB);
    await repo.createAsset(
      {
        id: "leaf-update-1",
        siteId: "site-leaf-a",
        r2Key: "uploads/leaf/update-1.png",
        filename: "u.png",
        mimeType: "image/png",
        sizeBytes: 8,
        width: 2,
        height: 2,
        altText: "original alt",
      },
      ACTOR,
    );

    await repo.updateAssetAltText("site-leaf-a", "leaf-update-1", "new alt");
    expect((await repo.getAsset("site-leaf-a", "leaf-update-1"))?.altText).toBe("new alt");

    await repo.updateAssetAltText("site-leaf-a", "leaf-update-1", null);
    expect((await repo.getAsset("site-leaf-a", "leaf-update-1"))?.altText).toBeNull();

    // Site-scoped update: a write scoped to another site must not touch our row.
    await repo.updateAssetAltText("site-leaf-b", "leaf-update-1", "hijacked");
    expect((await repo.getAsset("site-leaf-a", "leaf-update-1"))?.altText).toBeNull();
  });

  it("deleteAsset removes the asset and is a no-op for another site", async () => {
    const repo = createD1AssetRepository(env.DB);
    await repo.createAsset(
      {
        id: "leaf-delete-1",
        siteId: "site-leaf-a",
        r2Key: "uploads/leaf/delete-1.png",
        filename: "gone.png",
        mimeType: "image/png",
        sizeBytes: 1,
        width: 1,
        height: 1,
        altText: null,
      },
      ACTOR,
    );
    expect(await repo.getAsset("site-leaf-a", "leaf-delete-1")).not.toBeNull();

    await repo.deleteAsset("site-leaf-a", "leaf-delete-1");
    expect(await repo.getAsset("site-leaf-a", "leaf-delete-1")).toBeNull();

    // A delete scoped to the wrong site must leave the row intact.
    await repo.createAsset(
      {
        id: "leaf-delete-2",
        siteId: "site-leaf-a",
        r2Key: "uploads/leaf/delete-2.png",
        filename: "keep.png",
        mimeType: "image/png",
        sizeBytes: 2,
        width: 1,
        height: 1,
        altText: null,
      },
      ACTOR,
    );
    await repo.deleteAsset("site-leaf-b", "leaf-delete-2");
    expect(await repo.getAsset("site-leaf-a", "leaf-delete-2")).not.toBeNull();
  });

  it("isAssetReferencedAsCover is false until a same-site post references it, and is site-scoped", async () => {
    const repo = createD1AssetRepository(env.DB);
    const asset = await repo.createAsset(
      {
        id: "leaf-cover-1",
        siteId: "site-leaf-cover",
        r2Key: "uploads/leaf/cover-1.png",
        filename: "logo.png",
        mimeType: "image/png",
        sizeBytes: 512,
        width: 100,
        height: 100,
        altText: null,
      },
      ACTOR,
    );
    expect(await repo.isAssetReferencedAsCover("site-leaf-cover", asset.id)).toBe(false);

    const postCols =
      "id, site_id, title, slug, content_markdown, cover_asset_id, " +
      "created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
    await env.DB.prepare(`INSERT INTO posts (${postCols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        "leaf-cover-post",
        "site-leaf-cover",
        "Cover Post",
        "leaf-cover-post",
        "# x",
        asset.id,
        "human",
        "leaf-user",
        "human",
        "leaf-user",
        T_BASE,
        T_BASE,
      )
      .run();

    expect(await repo.isAssetReferencedAsCover("site-leaf-cover", asset.id)).toBe(true);
    // Site-scoped: the referencing post lives in site-leaf-cover, so a query
    // scoped to another site sees no cover reference.
    expect(await repo.isAssetReferencedAsCover("site-leaf-b", asset.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// subscribers
// ---------------------------------------------------------------------------

describe("SubscriberRepository (Drizzle)", () => {
  it("addPending is idempotent on (site, email): created:true then created:false with a single row", async () => {
    const repo = createD1SubscriberRepository(env.DB);
    const first = await repo.addPending({
      siteId: "site-leaf-sub-a",
      email: "leaf-alice@example.test",
      sourceUrl: null,
      consentText: "I agree to receive emails",
      consentVersion: "v1",
    });
    expect(first).toEqual({ created: true });

    const dup = await repo.addPending({
      siteId: "site-leaf-sub-a",
      email: "leaf-alice@example.test",
      sourceUrl: null,
      consentText: "I agree to receive emails",
      consentVersion: "v1",
    });
    expect(dup).toEqual({ created: false });

    // The ON CONFLICT DO NOTHING must have left exactly one row for this key.
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM subscribers WHERE site_id = ? AND email = ?",
    )
      .bind("site-leaf-sub-a", "leaf-alice@example.test")
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });

  it("addPending returns created:true for a different email or a different site", async () => {
    const repo = createD1SubscriberRepository(env.DB);
    const diffEmail = await repo.addPending({
      siteId: "site-leaf-sub-a",
      email: "leaf-bob@example.test",
      sourceUrl: null,
      consentText: "consent",
      consentVersion: "v1",
    });
    expect(diffEmail).toEqual({ created: true });

    // Same email as the prior test, but a different site -> distinct (site,email) key.
    const diffSite = await repo.addPending({
      siteId: "site-leaf-sub-b",
      email: "leaf-alice@example.test",
      sourceUrl: null,
      consentText: "consent",
      consentVersion: "v1",
    });
    expect(diffSite).toEqual({ created: true });
  });
});

// ---------------------------------------------------------------------------
// activity
// ---------------------------------------------------------------------------

describe("ActivityRepository (Drizzle)", () => {
  it("create inserts an activity event that listBySite returns", async () => {
    const repo = createActivityRepository(env.DB);
    await repo.create({
      siteId: "site-leaf-act-a",
      actor: ACTOR,
      action: "post.created",
      entityType: "post",
      entityId: "leaf-act-create-1",
      summary: "Created a post",
    });

    const events = await repo.listBySite("site-leaf-act-a", 50);
    const ours = events.find((e) => e.entityId === "leaf-act-create-1");
    expect(ours).toBeDefined();
    expect(ours?.action).toBe("post.created");
    expect(ours?.entityType).toBe("post");
    expect(ours?.summary).toBe("Created a post");
    expect(ours?.siteId).toBe("site-leaf-act-a");
    expect(ours?.actorType).toBe("human");
    expect(ours?.actorId).toBe(ACTOR.id);
  });

  it("listBySite returns events newest-first, scoped to the site, and honors the limit", async () => {
    const repo = createActivityRepository(env.DB);
    // Explicit created_at anchors make newest-first deterministic (the repo
    // stamps Date.now() at second granularity, which would tie and re-order
    // non-deterministically on equal timestamps).
    const cols =
      "id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, created_at";
    await env.DB.prepare(`INSERT INTO activity_events (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        "leaf-act-old",
        "site-leaf-act-list-a",
        "human",
        "leaf-user",
        "Leaf User",
        "post.created",
        "post",
        "ent-old",
        "old",
        null,
        null,
        T_BASE,
      )
      .run();
    await env.DB.prepare(`INSERT INTO activity_events (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        "leaf-act-new",
        "site-leaf-act-list-a",
        "human",
        "leaf-user",
        "Leaf User",
        "post.created",
        "post",
        "ent-new",
        "new",
        null,
        null,
        T_BASE + 100,
      )
      .run();
    await env.DB.prepare(`INSERT INTO activity_events (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        "leaf-act-other",
        "site-leaf-act-list-b",
        "human",
        "leaf-user",
        "Leaf User",
        "post.created",
        "post",
        "ent-other",
        "other",
        null,
        null,
        T_BASE + 50,
      )
      .run();

    const events = await repo.listBySite("site-leaf-act-list-a", 50);
    expect(events.map((e) => e.entityId)).toEqual(["ent-new", "ent-old"]);
    expect(events.some((e) => e.entityId === "ent-other")).toBe(false);

    const limited = await repo.listBySite("site-leaf-act-list-a", 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].entityId).toBe("ent-new");
  });
});

// ---------------------------------------------------------------------------
// domains (repo-level gaps not covered through the command layer)
// ---------------------------------------------------------------------------

describe("DomainRepository (Drizzle) — conflict + reclaim contracts", () => {
  it("insert maps a duplicate-hostname UNIQUE failure to ConflictError with the exact message", async () => {
    const repo = createD1DomainRepository(env.DB);
    // Existing row owns this hostname in site-leaf-dom-a.
    await env.DB.prepare(
      "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'pending', ?, ?)",
    )
      .bind("dom-leaf-owner", "site-leaf-dom-a", "leaf-conflict.example.test", T_BASE, T_BASE)
      .run();

    // A second insert of the same hostname (even from another site) must trip
    // the hostname UNIQUE constraint, which the repo translates to ConflictError.
    try {
      await repo.insert({
        id: "dom-leaf-dup",
        siteId: "site-leaf-dom-b",
        hostname: "leaf-conflict.example.test",
        type: "custom",
        status: "pending",
        cloudflareCustomHostnameId: null,
        verificationErrorsJson: null,
        createdAt: T_BASE,
        updatedAt: T_BASE,
      });
      throw new Error("expected repo.insert to throw on duplicate hostname");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      // Narrow the caught unknown with a real instanceof guard so the .message
      // read is compiler-checked rather than a fabricated inline cast.
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe("That domain is already connected to another blog.");
    }
  });

  it("reclaimStale returns the affected-row count, bounded by staleness and status", async () => {
    const repo = createD1DomainRepository(env.DB);

    // A stale pending custom row is reclaimable -> count 1, row removed.
    await env.DB.prepare(
      "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'pending', ?, ?)",
    )
      .bind("dom-reclaim-stale", "site-leaf-dom-a", "leaf-reclaim.example.test", T_OLD, T_OLD)
      .run();
    expect(await repo.reclaimStale("leaf-reclaim.example.test", T_OLD)).toBe(1);
    expect(
      await env.DB
        .prepare("SELECT id FROM domains WHERE hostname = ?")
        .bind("leaf-reclaim.example.test")
        .first<{ id: string }>(),
    ).toBeNull();
    // Nothing left to reclaim -> 0 (idempotent).
    expect(await repo.reclaimStale("leaf-reclaim.example.test", T_OLD)).toBe(0);

    // Boundary: a row newer than the threshold is NOT reclaimed (lte cutoff).
    await env.DB.prepare(
      "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'pending', ?, ?)",
    )
      .bind("dom-reclaim-fresh", "site-leaf-dom-a", "leaf-fresh.example.test", T_BASE, T_BASE)
      .run();
    expect(await repo.reclaimStale("leaf-fresh.example.test", T_BASE - 1)).toBe(0);
    expect(
      await env.DB
        .prepare("SELECT id FROM domains WHERE hostname = ?")
        .bind("leaf-fresh.example.test")
        .first<{ id: string }>(),
    ).not.toBeNull();

    // Boundary: an active custom row is never reclaimed, even when old.
    await env.DB.prepare(
      "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'active', ?, ?)",
    )
      .bind("dom-reclaim-active", "site-leaf-dom-a", "leaf-active.example.test", T_OLD, T_OLD)
      .run();
    expect(await repo.reclaimStale("leaf-active.example.test", T_OLD)).toBe(0);
  });
});
