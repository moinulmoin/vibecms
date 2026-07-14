import type { APIRoute } from "astro";
import { handleLlmsTxt } from "../server/public-feeds";
import { publicDb, publicRuntimeEnv } from "../server/runtime";

export const GET: APIRoute = async (context) => {
  return handleLlmsTxt(publicDb(context), context.request, publicRuntimeEnv(context));
};