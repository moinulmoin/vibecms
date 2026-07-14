import type { APIRoute } from "astro";
import { serveAsset } from "../../server/media";
import { publicAssetsBucket, publicDb } from "../../server/runtime";

export const GET: APIRoute = async (context) => {
  const assetId = context.params.assetId;
  if (!assetId) return new Response("Not found", { status: 404 });
  return serveAsset(publicDb(context), publicAssetsBucket(context), assetId);
};