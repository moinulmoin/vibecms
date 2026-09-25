/**
 * `/og.png` (blog home) and `/og/{slug}.png` (post) share cards.
 *
 * Every request re-resolves the site (entitlement + custom-domain checks) and
 * the published post from D1, then derives the card's content version
 * (`ogCardVersion`). That version keys all three layers, so a publish, theme,
 * or byline change can never serve a stale card:
 *
 *   1. Workers Cache API  key `…/og/{slug}.png?v={version}&site={siteId}`
 *   2. R2 ASSETS_BUCKET   `og/{siteId}/{slug}.png` (+ customMetadata.version)
 *   3. render             lazy `import("./og-render")` (Takumi WASM)
 *
 * Responses carry the site (and article) Cache-Tag, so the existing publish /
 * settings tag purges also sweep old entries. A request whose `?v=` matches
 * the current version is immutable for a year; any other `v` gets 5 minutes.
 */
import type { APIContext } from "astro";
import { buildOgCardModel, ogCardVersion } from "../../lib/og-card";
import { articleCacheTags, cachedArticleResponseBelongsToSite, siteCacheTag } from "../public-blog-cache";
import { getPublishedPost, resolveSite } from "../public-blog-data";
import { publicAssetsBucket, publicDb, publicRuntimeEnv } from "../runtime";

const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300, s-maxage=300";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function workersDefaultCache(): Cache | undefined {
  if (typeof caches === "undefined" || !("default" in caches)) return undefined;
  return caches.default as Cache;
}

function etagFor(version: string) {
  return `"og-${version}"`;
}

function clientResponse(request: Request, body: BodyInit | null, headers: Headers, version: string): Response {
  const requested = new URL(request.url).searchParams.get("v");
  const out = new Headers(headers);
  out.set("cache-control", requested === version ? IMMUTABLE : SHORT);
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etagFor(version))) {
    return new Response(null, { status: 304, headers: out });
  }
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: out });
}

/** Handle a share-card request; `slug` undefined = the blog-home card. */
export async function handleOgCardRequest(context: APIContext, slug: string | undefined): Promise<Response> {
  if (slug !== undefined && !SLUG_RE.test(slug)) return notFound();
  const env = publicRuntimeEnv(context);
  const db = publicDb(context);
  const request = context.request;
  const site = await resolveSite(request, db, env);
  if (!site) return notFound();
  const post = slug === undefined ? null : await getPublishedPost(db, site.id, slug);
  if (slug !== undefined && !post) return notFound();

  const url = new URL(request.url);
  const version = ogCardVersion(site, post, url.host);
  const cacheKey = new Request(
    `${url.origin}${url.pathname}?v=${version}&site=${encodeURIComponent(site.id)}`,
    { method: "GET" },
  );
  const headers = new Headers({
    "content-type": "image/png",
    "cache-control": IMMUTABLE,
    "cache-tag": (post ? articleCacheTags(site.id, post.slug) : [siteCacheTag(site.id)]).join(","),
    etag: etagFor(version),
    "x-content-type-options": "nosniff",
  });

  const cache = workersDefaultCache();
  const cached = await cache?.match(cacheKey);
  if (cached && cachedArticleResponseBelongsToSite(cached, site.id)) {
    return clientResponse(request, cached.body, headers, version);
  }

  const waitUntil = context.locals.cfContext?.waitUntil.bind(context.locals.cfContext);
  const bucket = publicAssetsBucket(context);
  const r2Key = `og/${site.id}/${post ? post.slug : "_home"}.png`;
  let png: Uint8Array<ArrayBuffer> | ArrayBuffer | null = null;
  try {
    const stored = await bucket.get(r2Key);
    if (stored && stored.customMetadata?.version === version) png = await stored.arrayBuffer();
  } catch (error) {
    console.warn("og card R2 read failed", error);
  }

  if (!png) {
    try {
      const { renderOgCardPng } = await import("./og-render");
      png = await renderOgCardPng(buildOgCardModel(site, post, url.host));
    } catch (error) {
      console.error("og card render failed", error);
      return new Response("Share image unavailable", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const put = bucket
      .put(r2Key, png, { httpMetadata: { contentType: "image/png" }, customMetadata: { version } })
      .catch((error: unknown) => console.warn("og card R2 write failed", error));
    if (waitUntil) waitUntil(put);
    else await put;
  }

  if (cache) {
    const put = cache.put(cacheKey, new Response(png, { headers })).catch((error: unknown) => {
      console.warn("og card cache write failed", error);
    });
    if (waitUntil) waitUntil(put);
    else await put;
  }
  return clientResponse(request, png, headers, version);
}
