/**
 * Public blog edge-caching layer (Astro public Worker).
 * Uses Cache-Tag headers + platform cache.purge via Astro cache provider at publish time.
 */

export const publicCacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

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