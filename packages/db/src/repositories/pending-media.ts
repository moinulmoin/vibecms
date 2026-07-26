import type { ActivityInput, Actor, Asset } from "@vc/core";

export type PendingMediaOpKind = "upload_cleanup" | "delete";

export type PendingMediaOperation = {
  id: string;
  kind: PendingMediaOpKind;
  siteId: string;
  storageKey: string;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  claimedAt: number | null;
  attempts: number;
  lastError: string | null;
};

export type ReserveUploadInput = {
  opId: string;
  siteId: string;
  storageKey: string;
  sizeBytes: number;
  /** When true (self-host), skip quota reservation and only insert the op. */
  skipQuota: boolean;
  /** Paid storage byte limit; ignored when skipQuota is true. */
  limit: number;
  now?: number;
};

export type FinalizeUploadInput = {
  opId: string;
  asset: Omit<Asset, "createdAt" | "updatedAt">;
  actor: Actor;
  activity: ActivityInput;
  now?: number;
};

export type DeleteAssetPendingInput = {
  opId: string;
  siteId: string;
  assetId: string;
  storageKey: string;
  sizeBytes: number;
  activity: ActivityInput;
  now?: number;
};

export class MediaQuotaExceededError extends Error {
  constructor() {
    super("media_quota_paid");
    this.name = "MediaQuotaExceededError";
  }
}

function mapOpRaw(row: Record<string, unknown>): PendingMediaOperation {
  return {
    id: String(row.id),
    kind: row.kind as PendingMediaOpKind,
    siteId: String(row.site_id),
    storageKey: String(row.storage_key),
    sizeBytes: Number(row.size_bytes),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

export interface PendingMediaRepository {
  /** Atomically reserve quota (unless skipQuota) and insert an upload_cleanup op. */
  reserveUpload(input: ReserveUploadInput): Promise<void>;
  /** Atomically insert asset + activity, release reservation, and delete the upload op.
   * All effects require a matching unclaimed upload_cleanup op; throws if asset insert is 0. */
  finalizeUpload(input: FinalizeUploadInput): Promise<Asset>;
  /** Atomically delete asset + insert activity + insert delete op. */
  deleteAssetWithPendingOp(input: DeleteAssetPendingInput): Promise<void>;
  /** List stale unclaimed (or claim-expired) ops, oldest first, bounded. */
  listClaimableOps(input: {
    now: number;
    staleBefore: number;
    claimExpiredBefore: number;
    limit: number;
  }): Promise<PendingMediaOperation[]>;
  /**
   * CAS claim: sets claimed_at when unclaimed or claim-expired.
   * Returns the row when claimed by this caller; null if lost the race.
   */
  claimOp(input: {
    opId: string;
    now: number;
    claimExpiredBefore: number;
  }): Promise<PendingMediaOperation | null>;
  /**
   * Atomically release upload reservation and delete op, only if still claimed_at matches.
   * Returns true when this caller applied the cleanup (prevents double-release).
   */
  finishUploadCleanup(input: {
    opId: string;
    siteId: string;
    sizeBytes: number;
    claimedAt: number;
    now?: number;
  }): Promise<boolean>;
  /**
   * Delete a delete-kind op only if claimed_at still matches.
   * Returns true when this caller removed it.
   */
  finishDeleteOp(input: { opId: string; claimedAt: number }): Promise<boolean>;
  /**
   * Record a failed attempt and clear claimed_at so another run can retry after timeout.
   * Only applies when claimed_at still matches.
   */
  failClaim(input: {
    opId: string;
    claimedAt: number;
    error: string;
    now?: number;
  }): Promise<boolean>;
  /** Unconditional op removal for the request that created it (happy-path delete). */
  removeOp(opId: string): Promise<boolean>;
  getOp(opId: string): Promise<PendingMediaOperation | null>;
  getMediaPendingBytes(siteId: string): Promise<number>;
}

export function createPendingMediaRepository(db: D1Database): PendingMediaRepository {
  const repo: PendingMediaRepository = {
    async reserveUpload(input) {
      const now = input.now ?? Math.floor(Date.now() / 1000);
      if (input.skipQuota) {
        await db
          .prepare(
            `INSERT INTO pending_media_operations
              (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
             VALUES (?, 'upload_cleanup', ?, ?, ?, ?, ?, NULL, 0, NULL)`,
          )
          .bind(input.opId, input.siteId, input.storageKey, input.sizeBytes, now, now)
          .run();
        return;
      }

      const [insertResult] = await db.batch([
        db
          .prepare(
            `INSERT INTO pending_media_operations
              (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
             SELECT ?, 'upload_cleanup', ?, ?, ?, ?, ?, NULL, 0, NULL
             WHERE (
               SELECT COALESCE(SUM(size_bytes), 0) FROM assets WHERE site_id = ?
             ) + (
               SELECT media_pending_bytes FROM sites WHERE id = ?
             ) + ? <= ?`,
          )
          .bind(
            input.opId,
            input.siteId,
            input.storageKey,
            input.sizeBytes,
            now,
            now,
            input.siteId,
            input.siteId,
            input.sizeBytes,
            input.limit,
          ),
        db
          .prepare(
            `UPDATE sites
             SET media_pending_bytes = media_pending_bytes + ?
             WHERE id = ?
               AND EXISTS (SELECT 1 FROM pending_media_operations WHERE id = ?)`,
          )
          .bind(input.sizeBytes, input.siteId, input.opId),
      ]);

      if (!insertResult.meta.changes) throw new MediaQuotaExceededError();
    },

    async finalizeUpload(input) {
      const now = input.now ?? Math.floor(Date.now() / 1000);
      const asset = input.asset;
      const activity = input.activity;
      // Every effect is gated on the same unclaimed upload_cleanup op. This closes
      // absent-op and reconciler-claimed races: a claimed/missing op cannot create
      // asset/activity or release quota. D1 batch keeps the four statements atomic.
      const matchingUnclaimedOp = `EXISTS (
               SELECT 1 FROM pending_media_operations
               WHERE id = ?
                 AND kind = 'upload_cleanup'
                 AND site_id = ?
                 AND storage_key = ?
                 AND size_bytes = ?
                 AND claimed_at IS NULL
             )`;
      const [assetResult] = await db.batch([
        db
          .prepare(
            `INSERT INTO assets (
              id, site_id, r2_key, filename, mime_type, size_bytes, width, height, alt_text,
              created_by_type, created_by_id, created_at, updated_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE ${matchingUnclaimedOp}`,
          )
          .bind(
            asset.id,
            asset.siteId,
            asset.r2Key,
            asset.filename,
            asset.mimeType,
            asset.sizeBytes,
            asset.width,
            asset.height,
            asset.altText,
            input.actor.type,
            input.actor.id,
            now,
            now,
            input.opId,
            asset.siteId,
            asset.r2Key,
            asset.sizeBytes,
          ),
        db
          .prepare(
            `INSERT INTO activity_events (
              id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id,
              summary, before_json, after_json, created_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE ${matchingUnclaimedOp}`,
          )
          .bind(
            crypto.randomUUID(),
            activity.siteId,
            activity.actor.type,
            activity.actor.id,
            activity.actor.name,
            activity.action,
            activity.entityType,
            activity.entityId,
            activity.summary,
            activity.before ? JSON.stringify(activity.before) : null,
            activity.after ? JSON.stringify(activity.after) : null,
            now,
            input.opId,
            asset.siteId,
            asset.r2Key,
            asset.sizeBytes,
          ),
        db
          .prepare(
            `UPDATE sites
             SET media_pending_bytes = MAX(0, media_pending_bytes - ?)
             WHERE id = ?
               AND ${matchingUnclaimedOp}`,
          )
          .bind(
            asset.sizeBytes,
            asset.siteId,
            input.opId,
            asset.siteId,
            asset.r2Key,
            asset.sizeBytes,
          ),
        db
          .prepare(
            `DELETE FROM pending_media_operations
             WHERE id = ?
               AND kind = 'upload_cleanup'
               AND site_id = ?
               AND storage_key = ?
               AND size_bytes = ?
               AND claimed_at IS NULL`,
          )
          .bind(input.opId, asset.siteId, asset.r2Key, asset.sizeBytes),
      ]);

      if (!assetResult.meta.changes) {
        throw new Error("Finalize requires matching unclaimed upload_cleanup op");
      }

      return { ...asset, createdAt: now, updatedAt: now };
    },

    async deleteAssetWithPendingOp(input) {
      const now = input.now ?? Math.floor(Date.now() / 1000);
      const activity = input.activity;
      await db.batch([
        db
          .prepare(`DELETE FROM assets WHERE id = ? AND site_id = ?`)
          .bind(input.assetId, input.siteId),
        db
          .prepare(
            `INSERT INTO activity_events (
              id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id,
              summary, before_json, after_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            activity.siteId,
            activity.actor.type,
            activity.actor.id,
            activity.actor.name,
            activity.action,
            activity.entityType,
            activity.entityId,
            activity.summary,
            activity.before ? JSON.stringify(activity.before) : null,
            activity.after ? JSON.stringify(activity.after) : null,
            now,
          ),
        db
          .prepare(
            `INSERT INTO pending_media_operations
              (id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error)
             VALUES (?, 'delete', ?, ?, ?, ?, ?, NULL, 0, NULL)`,
          )
          .bind(input.opId, input.siteId, input.storageKey, input.sizeBytes, now, now),
      ]);
    },

    async listClaimableOps(input) {
      const rows = await db
        .prepare(
          `SELECT id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error
           FROM pending_media_operations
           WHERE created_at <= ?
             AND (claimed_at IS NULL OR claimed_at <= ?)
           ORDER BY created_at ASC
           LIMIT ?`,
        )
        .bind(input.staleBefore, input.claimExpiredBefore, input.limit)
        .all();
      return (rows.results ?? []).map((row) => mapOpRaw(row as Record<string, unknown>));
    },

    async claimOp(input) {
      const result = await db
        .prepare(
          `UPDATE pending_media_operations
           SET claimed_at = ?, attempts = attempts + 1, updated_at = ?, last_error = NULL
           WHERE id = ?
             AND (claimed_at IS NULL OR claimed_at <= ?)`,
        )
        .bind(input.now, input.now, input.opId, input.claimExpiredBefore)
        .run();
      if (!result.meta.changes) return null;
      return repo.getOp(input.opId);
    },

    async finishUploadCleanup(input) {
      const [releaseResult] = await db.batch([
        db
          .prepare(
            `UPDATE sites
             SET media_pending_bytes = MAX(0, media_pending_bytes - ?)
             WHERE id = ?
               AND EXISTS (
                 SELECT 1 FROM pending_media_operations
                 WHERE id = ? AND kind = 'upload_cleanup' AND claimed_at = ?
               )`,
          )
          .bind(input.sizeBytes, input.siteId, input.opId, input.claimedAt),
        db
          .prepare(
            `DELETE FROM pending_media_operations
             WHERE id = ? AND kind = 'upload_cleanup' AND claimed_at = ?`,
          )
          .bind(input.opId, input.claimedAt),
      ]);
      return (releaseResult.meta.changes ?? 0) > 0;
    },

    async finishDeleteOp(input) {
      const result = await db
        .prepare(
          `DELETE FROM pending_media_operations
           WHERE id = ? AND kind = 'delete' AND claimed_at = ?`,
        )
        .bind(input.opId, input.claimedAt)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },

    async failClaim(input) {
      const now = input.now ?? Math.floor(Date.now() / 1000);
      const result = await db
        .prepare(
          `UPDATE pending_media_operations
           SET claimed_at = NULL, last_error = ?, updated_at = ?
           WHERE id = ? AND claimed_at = ?`,
        )
        .bind(input.error.slice(0, 500), now, input.opId, input.claimedAt)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },

    async removeOp(opId) {
      const result = await db.prepare(`DELETE FROM pending_media_operations WHERE id = ?`).bind(opId).run();
      return (result.meta.changes ?? 0) > 0;
    },

    async getOp(opId) {
      const row = await db
        .prepare(
          `SELECT id, kind, site_id, storage_key, size_bytes, created_at, updated_at, claimed_at, attempts, last_error
           FROM pending_media_operations WHERE id = ?`,
        )
        .bind(opId)
        .first();
      return row ? mapOpRaw(row as Record<string, unknown>) : null;
    },

    async getMediaPendingBytes(siteId) {
      const row = await db
        .prepare(`SELECT media_pending_bytes AS pending FROM sites WHERE id = ?`)
        .bind(siteId)
        .first<{ pending: number }>();
      return Number(row?.pending ?? 0);
    },
  };
  return repo;
}
