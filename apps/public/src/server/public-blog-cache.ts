/**
 * Public blog edge-caching layer (Astro public Worker).
 * Uses Cache-Tag headers + platform cache.purge via Astro cache provider at publish time.
 * Article HTML/Markdown Workers Cache entries use distinct URL keys so Accept negotiation
 * cannot collide with a prior HTML page-cache entry (miniflare Cache ignores Vary).
 */

import type { EffectiveHostedEntitlement } from "@vc/db";

export const publicCacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

export function publicCacheControlForEntitlement(
  entitlement: EffectiveHostedEntitlement,
  now = Math.floor(Date.now() / 1000),
): string {
  if (!entitlement.effective) return "no-store";
  if (entitlement.effectiveUntil === null) return publicCacheControl;
  const remaining = Math.max(0, entitlement.effectiveUntil - now);
  if (remaining === 0) return "no-store";
  const maxAge = Math.min(300, remaining);
  return `public, max-age=${maxAge}, s-maxage=${maxAge}`;
}

export type ArticleRepresentation = "html" | "markdown";

export function siteCacheTag(siteId: string) {
  return `vc-site:${siteId}`;
}

/** Stable Cache-Tag for a published article (purge-on-publish). */
export function articleCacheTag(siteId: string, postSlug: string) {
  return `vc-article:${siteId}:${postSlug}`;
}

export function articleCacheTags(siteId: string, postSlug: string) {
  return [siteCacheTag(siteId), articleCacheTag(siteId, postSlug)];
}

export function cachedArticleResponseBelongsToSite(response: Response, siteId: string): boolean {
  const cacheTags = response.headers.get("cache-tag");
  if (!cacheTags) return false;
  return cacheTags
    .split(",")
    .some((cacheTag) => cacheTag.trim() === siteCacheTag(siteId));
}

function workersDefaultCache(): Cache | undefined {
  if (typeof caches === "undefined") return undefined;
  if (!("default" in caches)) return undefined;
  return caches.default as Cache;
}

/** Canonical article page URL (no `.md`, no query) used as the HTML cache key base. */
export function canonicalArticlePageUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.search = "";
  if (url.pathname.endsWith(".md")) url.pathname = url.pathname.slice(0, -3);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

/**
 * Distinct cache Request per representation.
 * Markdown is keyed at `/slug.md` so it cannot collide with HTML at `/slug`.
 */
export function articleResponseCacheRequest(
  requestUrl: string,
  representation: ArticleRepresentation,
): Request {
  const pageUrl = canonicalArticlePageUrl(requestUrl);
  if (representation === "html") return new Request(pageUrl, { method: "GET" });
  return new Request(`${pageUrl}.md`, { method: "GET" });
}

export async function matchArticleResponseCache(
  requestUrl: string,
  representation: ArticleRepresentation,
): Promise<Response | undefined> {
  const cache = workersDefaultCache();
  if (!cache) return undefined;
  return cache.match(articleResponseCacheRequest(requestUrl, representation));
}

export async function putArticleResponseCache(
  requestUrl: string,
  representation: ArticleRepresentation,
  response: Response,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  const cache = workersDefaultCache();
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!cache || !response.ok || /(?:^|,)\s*no-store\s*(?:,|$)/i.test(cacheControl)) return;
  const put = cache.put(articleResponseCacheRequest(requestUrl, representation), response.clone());
  if (waitUntil) waitUntil(put);
  else await put;
}

/**
 * Proxied article responses need different Cache-Control for the customer CDN
 * vs our Workers Cache: the client-facing copy revalidates every time, but a
 * stored copy must keep its positive edge TTL — the Cache API honors the
 * stored response's Cache-Control, and `max-age=0, must-revalidate` entries
 * can't be served without revalidation the Worker never performs.
 *
 * Call this only on a cache-miss path where `body` is the buffered payload
 * (an ArrayBuffer can back both Responses; a stream cannot). `preparedHeaders`
 * is the middleware's post-processing header set (security headers, etag…);
 * `cacheable` gets a copy before the zero-age rewrite, `client` after.
 */
export function articleResponseForClientAndCache(
  response: Response,
  preparedHeaders: Headers,
  body: ArrayBuffer | null,
  proxied: boolean,
): { client: Response; cacheable?: Response } {
  const clientHeaders = new Headers(preparedHeaders);
  if (proxied && !/(?:no-store|private)/i.test(clientHeaders.get("cache-control") ?? "")) {
    clientHeaders.set("cache-control", "public, max-age=0, must-revalidate");
  }
  const base = { status: response.status, statusText: response.statusText };
  return {
    client: new Response(body, { ...base, headers: clientHeaders }),
    cacheable: proxied
      ? new Response(body, { ...base, headers: new Headers(preparedHeaders) })
      : undefined,
  };
}

export type ArticleCacheValidators = { etag?: string };

export async function contentEtag(content: string | ArrayBuffer): Promise<string> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return `W/"vc2-sha256-${hex}"`;
}

export function isArticleNotModified(request: Request, validators: ArticleCacheValidators): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (!ifNoneMatch || !validators.etag) return false;
  const current = validators.etag.replace(/^W\//, "");
  return ifNoneMatch
    .split(",")
    .some((candidate) => candidate.trim() === "*" || candidate.trim().replace(/^W\//, "") === current);
}

export function conditionalArticleResponse(
  request: Request,
  response: Response,
  validators: ArticleCacheValidators,
): Response {
  if (!isArticleNotModified(request, validators)) return response;
  return new Response(null, {
    status: 304,
    headers: response.headers,
  });
}

export function conditionalCachedArticleResponse(request: Request, response: Response): Response {
  return conditionalArticleResponse(request, response, {
    etag: response.headers.get("etag") ?? undefined,
  });
}

export function articleMarkdownAlternateLink(markdownHref: string): string {
  return `<${markdownHref}>; rel="alternate"; type="text/markdown"`;
}
