import type { APIRoute } from "astro";
import { handleFeed } from "../server/public-feeds";
import { publicDb, publicRuntimeEnv } from "../server/runtime";

export const GET: APIRoute = async (context) => {
  return handleFeed(publicDb(context), context.request, publicRuntimeEnv(context));
};