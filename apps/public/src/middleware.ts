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
import { articleResponseForClientAndCache, conditionalCachedArticleResponse, contentEtag } from "./server/public-blog-cache";
import { directLocation, type PublicLocation } from "./server/public-location";
import { ingressStateForPass, primaryLocationRedirect, resolvePublicLocationIngress } from "./server/public-location.server";
import { rewriteProxiedAssetsInHtml } from "./server/proxied-assets";
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
  const request = context.request;
  const requestUrl = new URL(request.url);
  // `pathname` is the blog-relative path: after proxy ingress it is the
  // stripped `/…` remainder, never the `/_vc/p/…` envelope.
  let pathname = requestUrl.pathname;
  let location: PublicLocation = directLocation(request);
  let rewrite: URL | null = null;

  if (pathname === "/__vc-health") {
    const response = Response.json(
      { ok: true, worker: "public" },
      { headers: { "cache-control": "no-store" } },
    );
    applyPublicSecurityHeaders(pathname, response.headers.get("content-type"), response.headers, location);
    return response;
  }

  // `pages/index.astro` rewrites `/` to `/internal/*`, which reruns this
  // middleware on the rewritten request. Locals survive the pass: reuse the
  // first pass's location and public path so the internal target is never
  // re-ingress resolved, canonical-redirected, or treated as an article.
  const ingressState = ingressStateForPass(context.locals);
  if (ingressState) {
    location = ingressState.location;
    pathname = ingressState.publicPath;
  } else {
    const ingress = await resolvePublicLocationIngress(env.DB, request, pathname, publicEnv);
    if (ingress.kind === "not-found") {
      // Unknown/inactive proxy id, or a valid id quoted on the wrong host:
      // plain 404, never render a page.
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (ingress.kind === "not-connected") {
      // The location is saved but never verified: tell the owner's visitors
      // setup is unfinished without redirecting them off the customer domain.
      return new Response("This blog isn't connected yet. Finish setup in vibecms.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (ingress.kind === "health") {
      const response = Response.json(
        { ok: true, siteId: ingress.siteId, proxyFingerprint: ingress.proxyFingerprint },
        { headers: { "cache-control": "no-store" } },
      );
      applyPublicSecurityHeaders("/_vc/health", response.headers.get("content-type"), response.headers, location);
      return response;
    }
    if (ingress.kind === "proxied") {
      location = ingress.location;
      pathname = ingress.path;
      // Internal rewrite to the stripped path; producers read location/publicPath
      // off locals and still see our Host header on context.request.
      rewrite = new URL(request.url);
      rewrite.pathname = pathname;
    }
    context.locals.publicLocation = location;
    context.locals.publicPath = pathname;
  }

  const redirect = canonicalHostRedirect(context.request, publicEnv);
  if (redirect) {
    applyPublicSecurityHeaders(new URL(context.request.url).pathname, null, redirect.headers, location);
    return redirect;
  }

  if (!publicEnv.selfHosted && isMarketingHost(context.request, publicEnv)) {
    const trustRedirect = marketingTrustRedirect(pathname);
    if (trustRedirect) return trustRedirect;
  }

  // Primary-location canonicalization (plan 022 §4): non-primary hosted GETs
  // 301 to the same path at the site's canonical mount. Rewrite passes keep
  // their already-resolved state; /internal/* targets are exempt anyway.
  if (!ingressState) {
    const primaryRedirect = await primaryLocationRedirect(env.DB, request, pathname, publicEnv, location);
    if (primaryRedirect) return primaryRedirect;
  }

  const response = rewrite ? await next(rewrite) : await next();
  // Agents probing /api/* here get a JSON pointer to the real API, not a page.
  if (response.status === 404 && pathname.startsWith("/api/")) {
    const apiMissing = Response.json(
      { error: { code: "NOT_FOUND", message: "No API here. The vibecms API lives on the app host.", docs: `${publicEnv.appUrl.replace(/\/$/, "")}/openapi.json` } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
    applyPublicSecurityHeaders(pathname, "application/json", apiMissing.headers, location);
    return apiMissing;
  }
  const missing = markdownErrorForRequest(context.request, response);
  if (missing) {
    applyPublicSecurityHeaders(pathname, missing.headers.get("content-type"), missing.headers, location);
    return missing;
  }
  const headers = new Headers(response.headers);
  varyAgentRepresentation(headers);
  const articleHtmlCacheHit = headers.has(ARTICLE_HTML_CACHE_HIT_HEADER);
  headers.delete(ARTICLE_HTML_CACHE_HIT_HEADER);
  applyPublicSecurityHeaders(pathname, headers.get("content-type"), headers, location);

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

  // Proxied HTML names our root-relative assets (/_astro, media, OG, icons):
  // rewrite them to the asset origin BEFORE buffering so the Workers-Cache
  // copy and the etag cover the rewritten bytes. Cache hits stream the
  // already-rewritten stored copy, so they are never re-transformed.
  const rewriteProxiedHtml =
    location.proxied && (headers.get("content-type") ?? "").toLowerCase().includes("text/html");
  const buffered = isArticleHtml && !articleHtmlCacheHit
    ? await (rewriteProxiedHtml ? rewriteProxiedAssetsInHtml(response, location) : response).arrayBuffer()
    : null;
  let body: BodyInit | null = buffered ?? response.body;
  if (buffered) {
    headers.set("etag", await contentEtag(buffered));
    // A rewritten buffer no longer matches any Content-Length the page sent.
    if (rewriteProxiedHtml) headers.delete("content-length");
  }

  // Uncached article HTML splits here: the Workers-Cache copy keeps the real
  // edge TTL while the customer-facing copy revalidates every time (see
  // articleResponseForClientAndCache). Cache hits stream straight through.
  if (isArticleHtml && buffered) {
    const split = articleResponseForClientAndCache(response, headers, buffered, location.proxied);
    // Non-indexable default-domain pages must remain readable but should not
    // poison the shared article cache with noindex metadata. Entitlement is
    // resolved on every uncached public read; paid/self-hosted responses are
    // the only article variants persisted here.
    if (!headers.has("x-robots-tag")) {
      const waitUntil = context.locals.cfContext?.waitUntil.bind(context.locals.cfContext);
      // Cache key = customer-facing location URL, so proxied and direct views
      // of the same post can never collide on our shared host.
      const cacheUrl = location.origin + location.basePath + pathname + requestUrl.search;
      await cachePublicPostHtmlResponse(cacheUrl, split.cacheable ?? split.client, waitUntil);
    }
    return conditionalCachedArticleResponse(context.request, split.client);
  }

  // Proxied responses must never sit stale in the customer's CDN: revalidate
  // every time (our own edge cache — keyed on the location URL — still serves
  // it fast). Private/no-store responses (previews) keep their stronger cap.
  if (location.proxied && !/(?:no-store|private)/i.test(headers.get("cache-control") ?? "")) {
    headers.set("cache-control", "public, max-age=0, must-revalidate");
  }
  // Non-article proxied HTML (index, tag, 404, listings) streams through the
  // same rewriter. Proxied article cache hits are already rewritten: the
  // stored copy was transformed before it entered the Workers Cache.
  if (rewriteProxiedHtml && !buffered && !articleHtmlCacheHit) {
    body = rewriteProxiedAssetsInHtml(new Response(response.body, response), location).body;
    headers.delete("content-length");
  }

  const outbound = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  if (isArticleHtml) {
    return conditionalCachedArticleResponse(context.request, outbound);
  }

  return outbound;
});
