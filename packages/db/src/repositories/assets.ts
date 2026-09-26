import { and, desc, eq, or, sql } from "drizzle-orm";
import { ConflictError, type ActivityInput, type Actor, type Asset, type AssetRepository } from "@vc/core";
import { assets, sites, type AssetRow } from "../schema";
import { createDbClient } from "../client";
import { createActivityRepository } from "./activity";

// Keep every saved cover restorable, and protect inline Markdown images plus
// the site's share image, logo, and favicon.
export const assetUnusedSql = `NOT EXISTS (SELECT 1 FROM posts WHERE posts.site_id = assets.site_id
    AND (posts.cover_asset_id = assets.id OR instr(posts.content_markdown, '/media-assets/' || assets.id) > 0))
  AND NOT EXISTS (SELECT 1 FROM post_versions WHERE post_versions.site_id = assets.site_id
    AND (post_versions.cover_asset_id = assets.id OR instr(post_versions.content_markdown, '/media-assets/' || assets.id) > 0))
  AND NOT EXISTS (SELECT 1 FROM sites WHERE sites.id = assets.site_id AND assets.id IN (sites.default_social_asset_id, sites.logo_asset_id, sites.favicon_asset_id))`;

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    siteId: row.siteId,
    r2Key: row.r2Key,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    altText: row.altText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Serve-time row: by-id-only asset lookup (NOT site-scoped) for media.ts serveAsset.
export interface AssetServeRow {
  id: string;
  siteId: string;
  r2Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
}

// DB-side read extensions beyond the @vc/core AssetRepository contract.
export interface AssetDbRepository extends AssetRepository {
  getMediaUsageBytes(siteId: string): Promise<number>;
  getAssetForServe(assetId: string): Promise<AssetServeRow | null>;
  existsForSite(siteId: string, assetId: string): Promise<boolean>;
  createAssetWithActivity(
    input: Omit<Asset, "createdAt" | "updatedAt">,
    actor: Actor,
    activity: ActivityInput,
  ): Promise<Asset>;
  deleteAssetWithActivity(siteId: string, assetId: string, activity: ActivityInput): Promise<void>;
}

export function createD1AssetRepository(db: D1Database): AssetDbRepository {
  const client = createDbClient(db);
  const activity = createActivityRepository(db);
  return {
    async createAsset(input, actor: Actor) {
      const timestamp = Math.floor(Date.now() / 1000);
      await client
        .insert(assets)
        .values({
          id: input.id,
          siteId: input.siteId,
          r2Key: input.r2Key,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          width: input.width,
          height: input.height,
          altText: input.altText,
          createdByType: actor.type,
          createdById: actor.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      const asset = await this.getAsset(input.siteId, input.id);
      if (!asset) throw new Error("Asset insert failed");
      return asset;
    },

    async listAssets(siteId: string) {
      const rows = await client
        .select()
        .from(assets)
        .where(eq(assets.siteId, siteId))
        .orderBy(desc(assets.createdAt));
      return rows.map(mapAsset);
    },

    async getAsset(siteId: string, assetId: string) {
      const rows = await client
        .select()
        .from(assets)
        .where(and(eq(assets.siteId, siteId), eq(assets.id, assetId)))
        .limit(1);
      return rows[0] ? mapAsset(rows[0]) : null;
    },

    createActivity(input: ActivityInput) {
      return activity.create(input);
    },

    async updateAssetAltText(siteId: string, assetId: string, altText: string | null) {
      const result = await db.prepare(`UPDATE assets SET alt_text = ?, updated_at = ?
        WHERE site_id = ? AND id = ? AND (? IS NOT NULL OR ${assetUnusedSql})`)
        .bind(altText, Math.floor(Date.now() / 1000), siteId, assetId, altText).run();
      if (!result.meta.changes && altText === null && await this.getAsset(siteId, assetId)) {
        throw new ConflictError("Alt text is required while this image is in use");
      }
    },

    async deleteAsset(siteId: string, assetId: string) {
      const result = await db.prepare(`DELETE FROM assets WHERE site_id = ? AND id = ? AND ${assetUnusedSql}`)
        .bind(siteId, assetId).run();
      if (!result.meta.changes && await this.getAsset(siteId, assetId)) throw new ConflictError("Asset is in use");
    },

    async isAssetReferencedAsCover(siteId: string, assetId: string) {
      const row = await db.prepare(`SELECT ${assetUnusedSql} AS unused FROM assets
        WHERE site_id = ? AND id = ?`).bind(siteId, assetId).first<{ unused: number }>();
      return row?.unused === 0;
    },

    async isAssetReferencedAsSiteSocialImage(siteId: string, assetId: string) {
      const rows = await client
        .select({ id: sites.id })
        .from(sites)
        .where(and(
          eq(sites.id, siteId),
          or(eq(sites.defaultSocialAssetId, assetId), eq(sites.logoAssetId, assetId), eq(sites.faviconAssetId, assetId)),
        ))
        .limit(1);
      return rows.length > 0;
    },
    // SUM(size_bytes) for media quota; coalesce to 0 when no assets exist.
    async getMediaUsageBytes(siteId: string) {
      const rows = await client
        .select({ total: sql<number>`coalesce(sum(${assets.sizeBytes}),0)`.mapWith(Number) })
        .from(assets)
        .where(eq(assets.siteId, siteId));
      return rows[0]?.total ?? 0;
    },

    // Serve-time row lookup BY ID ONLY (intentionally not site-scoped) for serveAsset.
    async getAssetForServe(assetId: string) {
      const rows = await client
        .select({
          id: assets.id,
          siteId: assets.siteId,
          r2Key: assets.r2Key,
          filename: assets.filename,
          mimeType: assets.mimeType,
          sizeBytes: assets.sizeBytes,
          altText: assets.altText,
        })
        .from(assets)
        .where(eq(assets.id, assetId))
        .limit(1);
      return rows[0] ?? null;
    },


    async createAssetWithActivity(input, actor: Actor, activityInput: ActivityInput) {
      const timestamp = Math.floor(Date.now() / 1000);
      await db.batch([
        db.prepare(
          `INSERT INTO assets (
            id, site_id, r2_key, filename, mime_type, size_bytes, width, height, alt_text,
            created_by_type, created_by_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          input.id,
          input.siteId,
          input.r2Key,
          input.filename,
          input.mimeType,
          input.sizeBytes,
          input.width,
          input.height,
          input.altText,
          actor.type,
          actor.id,
          timestamp,
          timestamp,
        ),
        db.prepare(
          `INSERT INTO activity_events (
            id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id,
            summary, before_json, after_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          activityInput.siteId,
          activityInput.actor.type,
          activityInput.actor.id,
          activityInput.actor.name,
          activityInput.action,
          activityInput.entityType,
          activityInput.entityId,
          activityInput.summary,
          activityInput.before ? JSON.stringify(activityInput.before) : null,
          activityInput.after ? JSON.stringify(activityInput.after) : null,
          timestamp,
        ),
      ]);
      const asset = await this.getAsset(input.siteId, input.id);
      if (!asset) throw new Error("Asset insert failed");
      return asset;
    },

    async deleteAssetWithActivity(siteId: string, assetId: string, activityInput: ActivityInput) {
      const timestamp = Math.floor(Date.now() / 1000);
      const [deleteResult] = await db.batch([
        db.prepare(`DELETE FROM assets WHERE id = ? AND site_id = ? AND ${assetUnusedSql}`).bind(assetId, siteId),
        db.prepare(
          `INSERT INTO activity_events (
            id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id,
            summary, before_json, after_json, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
        ).bind(
          crypto.randomUUID(),
          activityInput.siteId,
          activityInput.actor.type,
          activityInput.actor.id,
          activityInput.actor.name,
          activityInput.action,
          activityInput.entityType,
          activityInput.entityId,
          activityInput.summary,
          activityInput.before ? JSON.stringify(activityInput.before) : null,
          activityInput.after ? JSON.stringify(activityInput.after) : null,
          timestamp,
        ),
      ]);
      if (!deleteResult.meta.changes && await this.getAsset(siteId, assetId)) throw new ConflictError("Asset is in use");
    },

    // Cover-asset ownership check for assertCoverAssetOwnedBySite (id AND site_id).
    async existsForSite(siteId: string, assetId: string) {
      const rows = await client
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.id, assetId), eq(assets.siteId, siteId)))
        .limit(1);
      return rows.length > 0;
    },
  };
}
