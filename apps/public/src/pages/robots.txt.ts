import type { APIRoute } from "astro";
import { handleRobots } from "../server/public-feeds";
import { publicDb, publicRuntimeEnv } from "../server/runtime";

export const GET: APIRoute = async (context) => {
  return handleRobots(publicDb(context), context.request, publicRuntimeEnv(context));
};