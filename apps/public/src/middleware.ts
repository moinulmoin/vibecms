import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { canonicalHostRedirect } from "./server/canonical-host.server";
import {
  ARTICLE_HTML_CACHE_HIT_HEADER,
  cachePublicPostHtmlResponse,
  markdownRequested,
  isReadableTenantPostSlug,
  isMarketingHost,
  stripMarkdownSuffix,
} from "./server/public-blog";
import { conditionalCachedArticleResponse, contentEtag } from "./server/public-blog-cache";
import { parsePublicRuntimeEnv } from "./server/public-url";
import { applyPublicSecurityHeaders } from "./server/secure-response-headers";
import { markdownErrorForRequest, marketingTrustRedirect, varyAgentRepresentation } from "./lib/agent-discovery";

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

  if (!publicEnv.selfHosted && isMarketingHost(context.request, publicEnv)) {
    const trustRedirect = marketingTrustRedirect(pathname);
    if (trustRedirect) return trustRedirect;
  }

  const response = await next();
  // Agents probing /api/* here get a JSON pointer to the real API, not a page.
  if (response.status === 404 && pathname.startsWith("/api/")) {
    const apiMissing = Response.json(
      { error: { code: "NOT_FOUND", message: "No API here. The vibecms API lives on the app host.", docs: `${publicEnv.appUrl.replace(/\/$/, "")}/openapi.json` } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
    applyPublicSecurityHeaders(pathname, "application/json", apiMissing.headers);
    return apiMissing;
  }
  const missing = markdownErrorForRequest(context.request, response);
  if (missing) {
    applyPublicSecurityHeaders(pathname, missing.headers.get("content-type"), missing.headers);
    return missing;
  }
  const headers = new Headers(response.headers);
  varyAgentRepresentation(headers);
  const articleHtmlCacheHit = headers.has(ARTICLE_HTML_CACHE_HIT_HEADER);
  headers.delete(ARTICLE_HTML_CACHE_HIT_HEADER);
  applyPublicSecurityHeaders(pathname, headers.get("content-type"), headers);

  const slug = articleSlugCandidate(pathname);
  const article = slug ? stripMarkdownSuffix(slug) : null;
  const isArticleHtml = Boolean(
    context.request.method === "GET" &&
      response.ok &&
      article?.slug &&
      isReadableTenantPostSlug(article.slug) &&
      (article.slug !== "docs" && article.slug !== "internal" || publicEnv.selfHosted || !isMarketingHost(context.request, publicEnv)) &&
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
    // Non-indexable default-domain pages must remain readable but should not
    // poison the shared article cache with noindex metadata. Entitlement is
    // resolved on every uncached public read; paid/self-hosted responses are
    // the only article variants persisted here.
    if (!articleHtmlCacheHit && !headers.has("x-robots-tag")) {
      const waitUntil = context.locals.cfContext?.waitUntil.bind(context.locals.cfContext);
      await cachePublicPostHtmlResponse(context.request.url, outbound, waitUntil);
    }
    return conditionalCachedArticleResponse(context.request, outbound);
  }

  return outbound;
});
