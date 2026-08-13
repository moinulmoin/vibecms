import { getCollection, type CollectionEntry } from "astro:content";
import type { APIRoute } from "astro";
import { isMarketingHost } from "../server/public-blog";
import { publicRuntimeEnv } from "../server/runtime";
import { docsSource } from "../lib/docs-source";

export const GET: APIRoute = async (context) => {
  const env = publicRuntimeEnv(context);
  if (env.selfHosted || !isMarketingHost(context.request, env)) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const entries: CollectionEntry<"docs">[] = await getCollection("docs");
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const content = docsSource
    .getPages()
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((page) => {
      const entry = entriesById.get(page.data._raw.id);
      return `# ${page.data.title}\n\nSource: ${page.url}\n\n${entry?.body ?? ""}`;
    })
    .join("\n\n---\n\n");

  return new Response(`# vibecms documentation\n\n${content}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
