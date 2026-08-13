import type { APIRoute } from "astro";
import { llms } from "fumadocs-core/source";
import { docsSource } from "../lib/docs-source";
import { handleLlmsTxt } from "../server/public-feeds";
import { isMarketingHost } from "../server/public-blog";
import { publicDb, publicRuntimeEnv } from "../server/runtime";

export const GET: APIRoute = async (context) => {
  const env = publicRuntimeEnv(context);
  if (!env.selfHosted && isMarketingHost(context.request, env)) {
    return new Response(llms(docsSource).index(), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  return handleLlmsTxt(publicDb(context), context.request, env);
};