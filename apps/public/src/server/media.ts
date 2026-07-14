import { createDataAccess } from "@vc/db";

export async function serveAsset(db: D1Database, bucket: R2Bucket, assetId: string) {
  const row = await createDataAccess(db).assets.getAssetForServe(assetId);
  if (!row) return new Response("Not found", { status: 404 });
  const object = await bucket.get(row.r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": row.mimeType,
      "content-length": String(row.sizeBytes),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}