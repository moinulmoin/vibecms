import type { APIRoute } from "astro";
import { isMarketingHost } from "../server/public-blog";
import { publicRuntimeEnv } from "../server/runtime";

export const GET: APIRoute = (context) => {
  const env = publicRuntimeEnv(context);
  if (env.selfHosted || !isMarketingHost(context.request, env)) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { location: `${env.appUrl.replace(/\/$/, "")}/openapi.json` } });
};
