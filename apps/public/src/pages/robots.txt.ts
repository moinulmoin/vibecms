import type { APIRoute } from "astro";
import { handleRobots } from "../server/public-feeds";
import { publicLocationRequest } from "../server/public-location";
import { publicDb, publicRuntimeEnv } from "../server/runtime";

export const GET: APIRoute = async (context) => {
  const location = context.locals.publicLocation;
  const request = publicLocationRequest(context.request, location, context.locals.publicPath ?? context.url.pathname);
  return handleRobots(publicDb(context), request, publicRuntimeEnv(context), location);
};
