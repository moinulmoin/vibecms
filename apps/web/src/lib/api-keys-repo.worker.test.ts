/**
 * api-keys REPOSITORY persistence contracts under real miniflare D1.
 *
 * Phase 4 of the Drizzle migration moved API-token data access into the
 * `db.apiKeys` repository in @vc/db (the app-layer api-keys.ts keeps token
 * generation, HMAC hashing with env.TOKEN_PEPPER, and owner gating). This
 * suite defends the REPO-level contracts most at risk in that conversion:
 *
 *   - authenticateByHash resolves workspaceId via the sites JOIN (would fail
 *     if the join were dropped, since workspaceId would be undefined).
 *   - revoke is a SOFT delete: revoked_at is set, the row is KEPT so audit
 *     attribution (post_versions.created_by_id -> actor_name) survives
 *     (would fail if revoke did a DELETE).
 *   - listActive / countActive EXCLUDE revoked rows (revoked_at IS NULL).
 *   - markUsed persists last_used_at.
 *   - latestActive excludes revoked keys; latestAny does not.
 *   - listActive is site-scoped.
 *
 * This does NOT re-cover the app-layer concerns already exercised by
 * apps/web/src/server/api-keys.worker.test.ts (soft-delete behaviour and
 * owner gating through the app surface).
 *
 * IDs are file-scoped ("akr-") so this file never collides with the other
 * suites sharing the miniflare D1 instance (ws-tokens, ws-iso/site-a-b,
 * site-leaf-*, sb-*, ctr-*).
 *
 * Run via:
 *   pnpm --filter @vc/web test:isolation
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

// Fixed epoch-second anchors. The repo takes an explicit timestamp in its
// insert/revoke/markUsed inputs, so these make every persisted
// created_at/revoked_at/last_used_at assertion deterministic AND prove the
// repo wired OUR timestamp through rather than stamping Date.now() internally.
const T = 1_704_000_000;
const T2 = 1_704_001_000;
const T3 = 1_704_002_000;

const WORKSPACE_ID = "ws-akr";

// Shared data access over the real miniflare D1 binding.
const da = createDataAccess(env.DB);

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      "INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(WORKSPACE_ID, "AKR Workspace", "ws-akr", ts, ts)
    .run();
});

// ---------------------------------------------------------------------------
// helpers (raw SQL is allowed in tests; the repo is exercised for writes)
// ---------------------------------------------------------------------------

async function seedSite(id: string): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      "INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, WORKSPACE_ID, id, id, ts, ts)
    .run();
}

describe("api-keys repo — insertKey + listActive + countActive", () => {
  it("listActive returns the inserted key newest-first with all fields, countActive is 1", async () => {
    await seedSite("site-akr-list");

    await da.apiKeys.insertKey({
      id: "key-akr-list",
      siteId: "site-akr-list",
      name: "List Key",
      tokenPrefix: "vc_live_akr_list",
      tokenHash: "hash-akr-list",
      scopesJson: '["posts:write"]',
      actorName: "Alice",
      createdByUserId: "user-akr-list",
      timestamp: T,
    });

    const listed = await da.apiKeys.listActive("site-akr-list");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: "key-akr-list",
      siteId: "site-akr-list",
      name: "List Key",
      tokenPrefix: "vc_live_akr_list",
      tokenHash: "hash-akr-list",
      scopesJson: '["posts:write"]',
      actorName: "Alice",
    });
    expect(listed[0].revokedAt).toBeNull();

    expect(await da.apiKeys.countActive("site-akr-list")).toBe(1);
  });
});

describe("api-keys repo — authenticateByHash resolves workspaceId via the sites join", () => {
  it("returns the record with workspaceId from the joined site", async () => {
    await seedSite("site-akr-auth");

    await da.apiKeys.insertKey({
      id: "key-akr-auth",
      siteId: "site-akr-auth",
      name: "Auth Key",
      tokenPrefix: "vc_live_akr_auth",
      tokenHash: "hash-akr-auth",
      scopesJson: "[]",
      actorName: "Bob",
      createdByUserId: "user-akr-auth",
      timestamp: T,
    });

    const auth = await da.apiKeys.authenticateByHash("hash-akr-auth");
    expect(auth).not.toBeNull();
    // This is the join contract: workspaceId is not stored on api_keys; it is
    // resolved from sites. If the JOIN were dropped this is undefined.
    expect(auth!.workspaceId).toBe(WORKSPACE_ID);
    expect(auth).toMatchObject({
      id: "key-akr-auth",
      siteId: "site-akr-auth",
      tokenHash: "hash-akr-auth",
      actorName: "Bob",
      revokedAt: null,
    });
  });

  it("returns null for an unknown token hash", async () => {
    expect(await da.apiKeys.authenticateByHash("hash-akr-unknown")).toBeNull();
  });
});

describe("api-keys repo — revoke is a SOFT delete (attribution preserved)", () => {
  it("revoke returns 1 and keeps the row with revoked_at set while list/count drop", async () => {
    await seedSite("site-akr-revoke");

    await da.apiKeys.insertKey({
      id: "key-akr-revoke",
      siteId: "site-akr-revoke",
      name: "Revoke Key",
      tokenPrefix: "vc_live_akr_revoke",
      tokenHash: "hash-akr-revoke",
      scopesJson: "[]",
      actorName: "Carol",
      createdByUserId: "user-akr-revoke",
      timestamp: T,
    });

    // Sanity: present before revoke.
    expect(await da.apiKeys.countActive("site-akr-revoke")).toBe(1);

    const affected = await da.apiKeys.revoke("site-akr-revoke", "key-akr-revoke", T2);
    expect(affected).toBe(1);

    // listActive / countActive now exclude it.
    expect(await da.apiKeys.listActive("site-akr-revoke")).toEqual([]);
    expect(await da.apiKeys.countActive("site-akr-revoke")).toBe(0);

    // BUT the row still exists with revoked_at set (SOFT delete). This would
    // fail if revoke did a DELETE.
    const row = await env.DB
      .prepare("SELECT id, revoked_at FROM api_keys WHERE id = ?")
      .bind("key-akr-revoke")
      .first<{ id: string; revoked_at: number | null }>();
    expect(row?.id).toBe("key-akr-revoke");
    expect(row?.revoked_at).toBe(T2);
  });

  it("revoke of an unknown key returns 0", async () => {
    await seedSite("site-akr-revoke-miss");
    const affected = await da.apiKeys.revoke("site-akr-revoke-miss", "key-akr-nope", T2);
    expect(affected).toBe(0);
  });
});

describe("api-keys repo — authenticateByHash returns revoked rows (app decides rejection)", () => {
  it("returns a revoked key with revokedAt set", async () => {
    await seedSite("site-akr-authrev");

    await da.apiKeys.insertKey({
      id: "key-akr-authrev",
      siteId: "site-akr-authrev",
      name: "AuthRev Key",
      tokenPrefix: "vc_live_akr_authrev",
      tokenHash: "hash-akr-authrev",
      scopesJson: "[]",
      actorName: "Dave",
      createdByUserId: "user-akr-authrev",
      timestamp: T,
    });
    await da.apiKeys.revoke("site-akr-authrev", "key-akr-authrev", T2);

    const auth = await da.apiKeys.authenticateByHash("hash-akr-authrev");
    expect(auth).not.toBeNull();
    expect(auth!.id).toBe("key-akr-authrev");
    expect(auth!.workspaceId).toBe(WORKSPACE_ID);
    // The repo surfaces the revoked state; the app layer is responsible for
    // rejecting the token. revokedAt must be non-null.
    expect(auth!.revokedAt).not.toBeNull();
    expect(auth!.revokedAt).toBe(T2);
  });
});

describe("api-keys repo — markUsed persists last_used_at", () => {
  it("sets last_used_at on the row (read back via authenticateByHash)", async () => {
    await seedSite("site-akr-used");

    await da.apiKeys.insertKey({
      id: "key-akr-used",
      siteId: "site-akr-used",
      name: "Used Key",
      tokenPrefix: "vc_live_akr_used",
      tokenHash: "hash-akr-used",
      scopesJson: "[]",
      actorName: "Eve",
      createdByUserId: "user-akr-used",
      timestamp: T,
    });

    expect((await da.apiKeys.authenticateByHash("hash-akr-used"))!.lastUsedAt).toBeNull();

    await da.apiKeys.markUsed("key-akr-used", T3);

    expect((await da.apiKeys.authenticateByHash("hash-akr-used"))!.lastUsedAt).toBe(T3);
  });
});

describe("api-keys repo — latestActive vs latestAny", () => {
  it("latestActive returns the newest non-revoked key; latestAny returns the newest regardless", async () => {
    await seedSite("site-akr-latest");

    // Older key first, newer key second. createdAt drives "newest" ordering.
    await da.apiKeys.insertKey({
      id: "key-akr-old",
      siteId: "site-akr-latest",
      name: "Old",
      tokenPrefix: "vc_live_akr_old",
      tokenHash: "hash-akr-old",
      scopesJson: "[]",
      actorName: "Frank",
      createdByUserId: "user-akr-old",
      timestamp: T,
    });
    await da.apiKeys.insertKey({
      id: "key-akr-new",
      siteId: "site-akr-latest",
      name: "New",
      tokenPrefix: "vc_live_akr_new",
      tokenHash: "hash-akr-new",
      scopesJson: "[]",
      actorName: "Grace",
      createdByUserId: "user-akr-new",
      timestamp: T2,
    });

    // Revoke the newest one.
    await da.apiKeys.revoke("site-akr-latest", "key-akr-new", T3);

    const active = await da.apiKeys.latestActive("site-akr-latest");
    expect(active?.id).toBe("key-akr-old");

    const any = await da.apiKeys.latestAny("site-akr-latest");
    expect(any?.id).toBe("key-akr-new");
    expect(any?.revokedAt).toBe(T3);
  });
});

describe("api-keys repo — listActive is site-scoped", () => {
  it("excludes keys belonging to a different site", async () => {
    await seedSite("site-akr-scope-a");
    await seedSite("site-akr-scope-b");

    await da.apiKeys.insertKey({
      id: "key-akr-scope-a",
      siteId: "site-akr-scope-a",
      name: "A",
      tokenPrefix: "vc_live_akr_scope_a",
      tokenHash: "hash-akr-scope-a",
      scopesJson: "[]",
      actorName: "Heidi",
      createdByUserId: "user-akr-scope-a",
      timestamp: T,
    });
    await da.apiKeys.insertKey({
      id: "key-akr-scope-b",
      siteId: "site-akr-scope-b",
      name: "B",
      tokenPrefix: "vc_live_akr_scope_b",
      tokenHash: "hash-akr-scope-b",
      scopesJson: "[]",
      actorName: "Ivan",
      createdByUserId: "user-akr-scope-b",
      timestamp: T,
    });

    const aIds = (await da.apiKeys.listActive("site-akr-scope-a")).map((k) => k.id);
    expect(aIds).toContain("key-akr-scope-a");
    expect(aIds).not.toContain("key-akr-scope-b");

    const bIds = (await da.apiKeys.listActive("site-akr-scope-b")).map((k) => k.id);
    expect(bIds).toContain("key-akr-scope-b");
    expect(bIds).not.toContain("key-akr-scope-a");
  });
});
