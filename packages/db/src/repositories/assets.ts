import { and, desc, eq, sql } from "drizzle-orm";
import type { ActivityInput, Actor, Asset, AssetRepository } from "@vc/core";
import { assets, posts, sites, type AssetRow } from "../schema";
import { createDbClient } from "../client";
import { createActivityRepository } from "./activity";

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
      await client
        .update(assets)
        .set({ altText, updatedAt: Math.floor(Date.now() / 1000) })
        .where(and(eq(assets.siteId, siteId), eq(assets.id, assetId)))
        .run();
    },

    async deleteAsset(siteId: string, assetId: string) {
      await client
        .delete(assets)
        .where(and(eq(assets.siteId, siteId), eq(assets.id, assetId)))
        .run();
    },

    async isAssetReferencedAsCover(siteId: string, assetId: string) {
      const rows = await client
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.coverAssetId, assetId)))
        .limit(1);
      return rows.length > 0;
    },

    async isAssetReferencedAsSiteSocialImage(siteId: string, assetId: string) {
      const rows = await client
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, siteId), eq(sites.defaultSocialAssetId, assetId)))
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
