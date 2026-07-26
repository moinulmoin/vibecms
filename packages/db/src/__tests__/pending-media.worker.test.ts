/**
 * Pending media operation durability contracts under real miniflare D1.
 *
 * Covers atomic reserve+op, finalize (asset+activity+release+delete op),
 * delete+op, CAS claim exclusivity, and single-apply upload cleanup.
 *
 * IDs are file-scoped ("pmo-") so this suite never collides with other
 * miniflare D1 workers sharing the same test database.
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
  createPendingMediaRepository,
  MediaQuotaExceededError,
} from "@vc/db";
import type { Actor } from "@vc/core";

const WS = "pmo-ws";
const SITE = "pmo-site";
const ACTOR: Actor = { type: "human", id: "pmo-user", name: "PMO User", role: "owner" };
const LIMIT = 10_000;

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(WS, "PMO Workspace", WS, ts, ts)
    .run();
  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(SITE, WS, SITE, SITE, ts, ts)
    .run();
});

function repo() {
  return createPendingMediaRepository(env.DB);
}

describe("pending media operations (atomic D1)", () => {
  it("reserveUpload inserts op and bumps media_pending_bytes atomically", async () => {
    const pending = repo();
    const opId = "pmo-reserve-1";
    await pending.reserveUpload({
      opId,
      siteId: SITE,
      storageKey: `${SITE}/${opId}.png`,
      sizeBytes: 100,
      skipQuota: false,
      limit: LIMIT,
      now: 1_700_000_000,
    });
    expect(await pending.getMediaPendingBytes(SITE)).toBe(100);
    const op = await pending.getOp(opId);
    expect(op).toMatchObject({
      id: opId,
      kind: "upload_cleanup",
      sizeBytes: 100,
      claimedAt: null,
    });
  });

  it("reserveUpload rejects when quota would be exceeded and leaves no op", async () => {
    const pending = repo();
    const opId = "pmo-reserve-over";
    await expect(
      pending.reserveUpload({
        opId,
        siteId: SITE,
        storageKey: `${SITE}/${opId}.png`,
        sizeBytes: LIMIT,
        skipQuota: false,
        limit: LIMIT,
        now: 1_700_000_100,
      }),
    ).rejects.toBeInstanceOf(MediaQuotaExceededError);
    expect(await pending.getOp(opId)).toBeNull();
    // prior reservation of 100 still present
    expect(await pending.getMediaPendingBytes(SITE)).toBe(100);
  });

  it("finalizeUpload writes asset+activity, clears pending bytes, and removes op", async () => {
    const pending = repo();
    const opId = "pmo-finalize-1";
    await pending.reserveUpload({
      opId,
      siteId: SITE,
      storageKey: `${SITE}/${opId}.png`,
      sizeBytes: 50,
      skipQuota: false,
      limit: LIMIT,
      now: 1_700_000_200,
    });
    const beforePending = await pending.getMediaPendingBytes(SITE);
    const asset = await pending.finalizeUpload({
      opId,
      asset: {
        id: "pmo-asset-1",
        siteId: SITE,
        r2Key: `${SITE}/${opId}.png`,
        filename: "a.png",
        mimeType: "image/png",
        sizeBytes: 50,
        width: 10,
        height: 10,
        altText: null,
      },
      actor: ACTOR,
      activity: {
        siteId: SITE,
        actor: ACTOR,
        action: "asset.uploaded",
        entityType: "asset",
        entityId: "pmo-asset-1",
        summary: "Uploaded a.png",
      },
      now: 1_700_000_201,
    });
    expect(asset.id).toBe("pmo-asset-1");
    expect(await pending.getOp(opId)).toBeNull();
    expect(await pending.getMediaPendingBytes(SITE)).toBe(beforePending - 50);
    const activity = await env.DB.prepare(
      "SELECT action FROM activity_events WHERE entity_id = ?",
    )
      .bind("pmo-asset-1")
      .first<{ action: string }>();
    expect(activity?.action).toBe("asset.uploaded");
  });

  it("deleteAssetWithPendingOp removes asset, writes activity, inserts delete op", async () => {
    const pending = repo();
    const opId = "pmo-delete-1";
    await pending.deleteAssetWithPendingOp({
      opId,
      siteId: SITE,
      assetId: "pmo-asset-1",
      storageKey: `${SITE}/pmo-finalize-1.png`,
      sizeBytes: 50,
      activity: {
        siteId: SITE,
        actor: ACTOR,
        action: "asset.deleted",
        entityType: "asset",
        entityId: "pmo-asset-1",
        summary: "Deleted a.png",
      },
      now: 1_700_000_300,
    });
    const asset = await env.DB.prepare("SELECT id FROM assets WHERE id = ?")
      .bind("pmo-asset-1")
      .first();
    expect(asset).toBeNull();
    const op = await pending.getOp(opId);
    expect(op?.kind).toBe("delete");
    const activity = await env.DB.prepare(
      "SELECT action FROM activity_events WHERE entity_id = ? AND action = ?",
    )
      .bind("pmo-asset-1", "asset.deleted")
      .first();
    expect(activity).toBeTruthy();
  });

  it("claimOp is exclusive: only one concurrent claim wins", async () => {
    const pending = repo();
    const opId = "pmo-claim-race";
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'upload_cleanup', ?, ?, 10, ?, ?, NULL, 0, NULL)`,
    )
      .bind(opId, SITE, `${SITE}/race.png`, 1_600_000_000, 1_600_000_000)
      .run();

    const now = 1_700_001_000;
    const claimExpiredBefore = now - 600;
    const [a, b] = await Promise.all([
      pending.claimOp({ opId, now, claimExpiredBefore }),
      pending.claimOp({ opId, now: now + 1, claimExpiredBefore }),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.claimedAt).toBeTruthy();
    expect(winners[0]?.attempts).toBe(1);
  });

  it("finishUploadCleanup releases quota once under matching claim", async () => {
    const pending = repo();
    const opId = "pmo-cleanup-once";
    // seed reservation + op
    await env.DB.prepare("UPDATE sites SET media_pending_bytes = media_pending_bytes + 77 WHERE id = ?")
      .bind(SITE)
      .run();
    const claimedAt = 1_700_002_000;
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'upload_cleanup', ?, ?, 77, ?, ?, ?, 1, NULL)`,
    )
      .bind(opId, SITE, `${SITE}/once.png`, 1_600_000_000, claimedAt, claimedAt)
      .run();
    const before = await pending.getMediaPendingBytes(SITE);

    const first = await pending.finishUploadCleanup({
      opId,
      siteId: SITE,
      sizeBytes: 77,
      claimedAt,
    });
    const second = await pending.finishUploadCleanup({
      opId,
      siteId: SITE,
      sizeBytes: 77,
      claimedAt,
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await pending.getMediaPendingBytes(SITE)).toBe(before - 77);
    expect(await pending.getOp(opId)).toBeNull();
  });


  it("finalizeUpload with absent op creates neither asset nor activity and leaves quota", async () => {
    const pending = repo();
    const before = await pending.getMediaPendingBytes(SITE);
    const opId = "pmo-finalize-absent";
    await expect(
      pending.finalizeUpload({
        opId,
        asset: {
          id: "pmo-asset-absent",
          siteId: SITE,
          r2Key: `${SITE}/absent.png`,
          filename: "absent.png",
          mimeType: "image/png",
          sizeBytes: 40,
          width: 10,
          height: 10,
          altText: null,
        },
        actor: ACTOR,
        activity: {
          siteId: SITE,
          actor: ACTOR,
          action: "asset.uploaded",
          entityType: "asset",
          entityId: "pmo-asset-absent",
          summary: "Uploaded absent.png",
        },
        now: 1_700_004_000,
      }),
    ).rejects.toThrow(/matching unclaimed upload_cleanup op/i);

    const asset = await env.DB.prepare("SELECT id FROM assets WHERE id = ?")
      .bind("pmo-asset-absent")
      .first();
    expect(asset).toBeNull();
    const activity = await env.DB.prepare(
      "SELECT id FROM activity_events WHERE entity_id = ? AND action = ?",
    )
      .bind("pmo-asset-absent", "asset.uploaded")
      .first();
    expect(activity).toBeNull();
    expect(await pending.getMediaPendingBytes(SITE)).toBe(before);
  });

  it("finalizeUpload with claimed op creates neither asset nor activity and leaves quota", async () => {
    const pending = repo();
    const opId = "pmo-finalize-claimed";
    const key = `${SITE}/claimed.png`;
    const claimedAt = 1_700_005_000;
    await env.DB.prepare("UPDATE sites SET media_pending_bytes = media_pending_bytes + 40 WHERE id = ?")
      .bind(SITE)
      .run();
    await env.DB.prepare(
      `INSERT INTO pending_media_operations
        (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
       VALUES (?, 'upload_cleanup', ?, ?, 40, ?, ?, ?, 1, NULL)`,
    )
      .bind(opId, SITE, key, 1_600_000_000, claimedAt, claimedAt)
      .run();
    const before = await pending.getMediaPendingBytes(SITE);

    await expect(
      pending.finalizeUpload({
        opId,
        asset: {
          id: "pmo-asset-claimed",
          siteId: SITE,
          r2Key: key,
          filename: "claimed.png",
          mimeType: "image/png",
          sizeBytes: 40,
          width: 10,
          height: 10,
          altText: null,
        },
        actor: ACTOR,
        activity: {
          siteId: SITE,
          actor: ACTOR,
          action: "asset.uploaded",
          entityType: "asset",
          entityId: "pmo-asset-claimed",
          summary: "Uploaded claimed.png",
        },
        now: claimedAt + 1,
      }),
    ).rejects.toThrow(/matching unclaimed upload_cleanup op/i);

    const asset = await env.DB.prepare("SELECT id FROM assets WHERE id = ?")
      .bind("pmo-asset-claimed")
      .first();
    expect(asset).toBeNull();
    const activity = await env.DB.prepare(
      "SELECT id FROM activity_events WHERE entity_id = ? AND action = ?",
    )
      .bind("pmo-asset-claimed", "asset.uploaded")
      .first();
    expect(activity).toBeNull();
    expect(await pending.getMediaPendingBytes(SITE)).toBe(before);
    // Op remains claimed for reconciler.
    const op = await pending.getOp(opId);
    expect(op?.claimedAt).toBe(claimedAt);
  });

  it("skipQuota reserve inserts op without changing pending bytes", async () => {
    const pending = repo();
    const before = await pending.getMediaPendingBytes(SITE);
    const opId = "pmo-skip-quota";
    await pending.reserveUpload({
      opId,
      siteId: SITE,
      storageKey: `${SITE}/skip.png`,
      sizeBytes: 999,
      skipQuota: true,
      limit: 0,
      now: 1_700_003_000,
    });
    expect(await pending.getMediaPendingBytes(SITE)).toBe(before);
    expect(await pending.getOp(opId)).toBeTruthy();
  });
});
