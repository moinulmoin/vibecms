import type { APIRoute } from "astro";
import { authMarkdown } from "../lib/agent-discovery";
import { isMarketingHost } from "../server/public-blog";
import { publicRuntimeEnv } from "../server/runtime";
import { publicOrigin } from "../server/public-url";

export const GET: APIRoute = (context) => {
  const env = publicRuntimeEnv(context);
  if (env.selfHosted || !isMarketingHost(context.request, env)) return new Response("Not found", { status: 404 });
  return new Response(authMarkdown(env.appUrl, publicOrigin(context.request.url)), { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
