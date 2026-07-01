import { and, desc, eq } from "drizzle-orm";
import type { ActivityInput, Actor, Asset, AssetRepository } from "@vc/core";
import { assets, posts, type AssetRow } from "../schema";
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

export function createD1AssetRepository(db: D1Database): AssetRepository {
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
  };
}
