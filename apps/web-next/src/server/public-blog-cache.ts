/**
 * Public blog edge-caching layer.
 *
 * CURRENT STATE (as of 2026-06-21):
 *   - All public blog HTML and markdown responses carry:
 *       cache-control: public, max-age=300, s-maxage=300, stale-while-revalidate=86400
 *       cache-tag:     vc-article:<siteId>:<postSlug>  (post-detail responses only)
 *   - Cloudflare does NOT cache HTML responses by default, even with s-maxage set.
 *     Zone-level CDN caching requires a "Cache Everything" Cache Rule scoped to
 *     /blog/* and *.vibecms.dev/* in the Cloudflare dashboard. Until those rules
 *     are enabled, pages are served by the Worker on every request - browsers still
 *     observe max-age=300 for client-side caching.
 *   - No Workers Cache API (caches.default.put) is used today. Workers Cache API
 *     was intentionally deferred: subdomain-mode routes (*.vibecms.dev/*) are not
 *     yet wired as TanStack Start route handlers, so purge via articleCacheUrls
 *     cannot be proven correct for the subdomain URL shape. Once subdomain routes
 *     are wired, a caches.default middleware is appropriate and articleCacheUrls
 *     should be extended to include https://<siteSlug>.<PUBLIC_BLOG_DOMAIN>/<postSlug>.
 *
 * PURGE WIRING (complete):
 *   - publish: operations.ts publishPostOp, post-mutations.ts publishPostForApp
 *   - update (if published): post-mutations.ts updatePostForApp -> purgeIfPublished
 *   - archive: operations.ts archivePostOp, post-mutations.ts archivePostForApp
 *
 * PURGE MECHANISM:
 *   Primary   - Cloudflare zone API by cache-tag (covers all URLs for a post across
 *               both path-mode and subdomain-mode). Requires CLOUDFLARE_ZONE_ID and
 *               CACHE_PURGE_API_TOKEN secrets to be set (see plans/PROD-LAUNCH.md).
 *   Fallback  - caches.default.delete() for path-mode URLs only (subdomain URLs not
 *               included in articleCacheUrls). Safe to leave as-is while zone-level
 *               CDN caching (Cache Rules) is the intended production caching path.
 */

import { env } from "cloudflare:workers";

export const publicCacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

/** Stable Cache-Tag for a published article (purge-on-publish). */
export function articleCacheTag(siteId: string, postSlug: string) {
  return `vc-article:${siteId}:${postSlug}`;
}

export function articleCacheUrls(siteSlug: string, postSlug: string, appUrl: string) {
  const base = appUrl.replace(/\/$/, "");
  return [
    `${base}/blog/${siteSlug}/${postSlug}`,
    `${base}/blog/${siteSlug}/${postSlug}.md`,
    `${base}/${postSlug}`,
    `${base}/${postSlug}.md`,
  ];
}

/**
 * Purge edge-cached article HTML/markdown after publish or update. Fail-open.
 */
export async function purgeArticleCache(siteId: string, siteSlug: string, postSlug: string): Promise<void> {
  const tag = articleCacheTag(siteId, postSlug);
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const token = env.CACHE_PURGE_API_TOKEN;
  const appUrl = env.APP_URL || "http://localhost:3000";

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
    for (const url of articleCacheUrls(siteSlug, postSlug, appUrl)) {
      await cache.delete(new Request(url));
    }
  } catch {
    // fail-open: publish must not depend on purge
  }
}