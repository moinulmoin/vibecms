import type { APIRoute } from "astro";
import { handleSitemap } from "../server/public-feeds";
import { publicDb, publicRuntimeEnv } from "../server/runtime";

export const GET: APIRoute = async (context) => {
  return handleSitemap(publicDb(context), context.request, publicRuntimeEnv(context));
};