import type { ActivityInput, Actor, Asset, AssetRepository } from "@vc/core";

type AssetRow = {
  id: string;
  site_id: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  created_at: number;
  updated_at: number;
};

function now() {
  return Math.floor(Date.now() / 1000);
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    siteId: row.site_id,
    r2Key: row.r2_key,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    altText: row.alt_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createD1AssetRepository(db: D1Database): AssetRepository {
  return {
    async createAsset(input, actor: Actor) {
      const timestamp = now();
      await db.prepare(
        `INSERT INTO assets (id, site_id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, created_by_type, created_by_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(input.id, input.siteId, input.r2Key, input.filename, input.mimeType, input.sizeBytes, input.width, input.height, input.altText, actor.type, actor.id, timestamp, timestamp).run();
      const asset = await this.getAsset(input.siteId, input.id);
      if (!asset) throw new Error("Asset insert failed");
      return asset;
    },

    async listAssets(siteId) {
      const rows = await db.prepare(
        `SELECT id, site_id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, created_at, updated_at
         FROM assets WHERE site_id = ? ORDER BY created_at DESC`,
      ).bind(siteId).all<AssetRow>();
      return rows.results.map(mapAsset);
    },

    async getAsset(siteId, assetId) {
      const row = await db.prepare(
        `SELECT id, site_id, r2_key, filename, mime_type, size_bytes, width, height, alt_text, created_at, updated_at
         FROM assets WHERE site_id = ? AND id = ? LIMIT 1`,
      ).bind(siteId, assetId).first<AssetRow>();
      return row ? mapAsset(row) : null;
    },

    async createActivity(input: ActivityInput) {
      await db.prepare(
        `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        input.siteId,
        input.actor.type,
        input.actor.id,
        input.actor.name,
        input.action,
        input.entityType,
        input.entityId,
        input.summary,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        now(),
      ).run();
    },

    async deleteAsset(siteId: string, assetId: string) {
      await db.prepare("DELETE FROM assets WHERE site_id = ? AND id = ?").bind(siteId, assetId).run();
    },

    async isAssetReferencedAsCover(siteId: string, assetId: string) {
      const r = await db.prepare("SELECT 1 FROM posts WHERE site_id = ? AND cover_asset_id = ? LIMIT 1").bind(siteId, assetId).first();
      return r != null;
    },
  };
}
