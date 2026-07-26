import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { canonicalHostRedirect } from "./server/canonical-host.server";
import {
  ARTICLE_HTML_CACHE_HIT_HEADER,
  RESERVED_ROOT_SLUGS,
  cachePublicPostHtmlResponse,
  markdownRequested,
  stripMarkdownSuffix,
} from "./server/public-blog";
import { conditionalCachedArticleResponse, contentEtag } from "./server/public-blog-cache";
import { parsePublicRuntimeEnv } from "./server/public-url";
import { applyPublicSecurityHeaders } from "./server/secure-response-headers";

function articleSlugCandidate(pathname: string): string | undefined {
  if (pathname === "/" || pathname.length < 2) return undefined;
  const segment = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (!segment || segment.includes("/")) return undefined;
  return segment;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const publicEnv = parsePublicRuntimeEnv(env);
  context.locals.publicEnv = publicEnv;
  const pathname = new URL(context.request.url).pathname;
  if (pathname === "/__vc-health") {
    const response = Response.json(
      { ok: true, worker: "public" },
      { headers: { "cache-control": "no-store" } },
    );
    applyPublicSecurityHeaders(pathname, response.headers.get("content-type"), response.headers);
    return response;
  }


  const redirect = canonicalHostRedirect(context.request, publicEnv);
  if (redirect) {
    applyPublicSecurityHeaders(new URL(context.request.url).pathname, null, redirect.headers);
    return redirect;
  }

  const response = await next();
  const headers = new Headers(response.headers);
  const articleHtmlCacheHit = headers.has(ARTICLE_HTML_CACHE_HIT_HEADER);
  headers.delete(ARTICLE_HTML_CACHE_HIT_HEADER);
  applyPublicSecurityHeaders(pathname, headers.get("content-type"), headers);

  const slug = articleSlugCandidate(pathname);
  const article = slug ? stripMarkdownSuffix(slug) : null;
  const isArticleHtml = Boolean(
    context.request.method === "GET" &&
      response.ok &&
      article?.slug &&
      !RESERVED_ROOT_SLUGS.has(article.slug) &&
      !article.markdown &&
      !markdownRequested(context.request) &&
      (headers.get("content-type") || "").includes("text/html"),
  );
  if (isArticleHtml) headers.delete("last-modified");

  let body: BodyInit | null = response.body;
  if (isArticleHtml && !articleHtmlCacheHit) {
    body = await response.arrayBuffer();
    headers.set("etag", await contentEtag(body));
  }

  const outbound = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  if (isArticleHtml) {
    if (!articleHtmlCacheHit) {
      const waitUntil = context.locals.cfContext?.waitUntil.bind(context.locals.cfContext);
      await cachePublicPostHtmlResponse(context.request.url, outbound, waitUntil);
    }
    return conditionalCachedArticleResponse(context.request, outbound);
  }

  return outbound;
});
