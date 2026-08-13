import type { APIRoute } from "astro";
import { createFromSource } from "fumadocs-core/search/server";
import { docsSource } from "../lib/docs-source";
import { isMarketingHost } from "../server/public-blog";
import { publicRuntimeEnv } from "../server/runtime";

const search = createFromSource(docsSource);

export const GET: APIRoute = async (context) => {
  const env = publicRuntimeEnv(context);
  if (env.selfHosted || !isMarketingHost(context.request, env)) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return search.staticGET();
};
