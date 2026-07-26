import type { APIRoute } from "astro";
import { serveAsset } from "../../server/media";
import { publicAssetsBucket, publicDb, publicImages } from "../../server/runtime";

export const GET: APIRoute = async (context) => {
  const assetId = context.params.assetId;
  if (!assetId) return new Response("Not found", { status: 404 });

  const waitUntil = context.locals.cfContext?.waitUntil.bind(context.locals.cfContext);

  return serveAsset(publicDb(context), publicAssetsBucket(context), assetId, {
    request: context.request,
    widthParam: context.url.searchParams.get("w"),
    images: publicImages(context),
    waitUntil,
  });
};
