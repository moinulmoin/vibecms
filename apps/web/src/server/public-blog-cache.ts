/**
 * Public blog edge-caching layer.
 *
 * CURRENT STATE (host-only URL model):
 *   - All public blog HTML and markdown responses carry:
 *       cache-control: public, max-age=300, s-maxage=300, stale-while-revalidate=86400
 *       cache-tag:     vc-article:<siteId>:<postSlug>  (post-detail responses only)
 *   - Cloudflare does NOT cache HTML responses by default, even with s-maxage set.
 *     Zone-level CDN caching requires a "Cache Everything" Cache Rule scoped to
 *     *.vibecms.dev/* (and custom blog domains) in the Cloudflare dashboard. Until those
 *     rules are enabled, pages are served by the Worker on every request - browsers still
 *     observe max-age=300 for client-side caching.
 *
 * PURGE WIRING (complete):
 *   - publish: operations.ts publishPostOp, post-mutations.ts publishPostForApp
 *   - update (if published): post-mutations.ts updatePostForApp -> purgeIfPublished
 *   - archive: operations.ts archivePostOp, post-mutations.ts archivePostForApp
 *
 * PURGE MECHANISM:
 *   Primary   - Cloudflare zone API by cache-tag (covers every URL for a post across the
 *               default subdomain and any custom domain). Requires CLOUDFLARE_ZONE_ID and
 *               CACHE_PURGE_API_TOKEN secrets to be set (see plans/PROD-LAUNCH.md).
 *   Fallback  - caches.default.delete() for the default-subdomain host URLs derived from
 *               PUBLIC_BLOG_DOMAIN (best-effort per-datacenter; custom domains are covered
 *               by the cache-tag purge above).
 */

import { env } from "cloudflare:workers";
import { defaultHostname, publicBlogBaseDomain } from "./public-url";

export const publicCacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

/** Stable Cache-Tag for a published article (purge-on-publish). */
export function articleCacheTag(siteId: string, postSlug: string) {
  return `vc-article:${siteId}:${postSlug}`;
}

// Default-subdomain host URLs for a published post (best-effort Workers Cache fallback).
// Returns [] when no public blog domain is configured (cache-tag purge is the real path).
export function articleCacheUrls(siteSlug: string, postSlug: string): string[] {
  if (!publicBlogBaseDomain()) return [];
  const base = `https://${defaultHostname(siteSlug)}`;
  return [`${base}/${postSlug}`, `${base}/${postSlug}.md`];
}

/**
 * Purge edge-cached article HTML/markdown after publish or update. Fail-open.
 */
export async function purgeArticleCache(siteId: string, siteSlug: string, postSlug: string): Promise<void> {
  const tag = articleCacheTag(siteId, postSlug);
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const token = env.CACHE_PURGE_API_TOKEN;

  try {
    if (zoneId && token) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: [tag] }),
      });
      if (res.ok) return;
    }

    const cache = (caches as CacheStorage & { default: Cache }).default;
    for (const url of articleCacheUrls(siteSlug, postSlug)) {
      await cache.delete(new Request(url));
    }
  } catch {
    // fail-open: publish must not depend on purge
  }
}
