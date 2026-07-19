/**
 * Public blog edge-caching layer (API Worker schedules purge via executionCtx.waitUntil).
 */

import { env } from "cloudflare:workers";
import { defaultHostname, publicBlogBaseDomain } from "./public-url";

export const publicCacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

export function articleCacheTag(siteId: string, postSlug: string) {
  return `vc-article:${siteId}:${postSlug}`;
}

export function siteCacheTag(siteId: string) {
  return `vc-site:${siteId}`;
}

export function articleCacheUrls(siteSlug: string, postSlug: string): string[] {
  if (!publicBlogBaseDomain()) return [];
  const base = `https://${defaultHostname(siteSlug)}`;
  return [`${base}/${postSlug}`, `${base}/${postSlug}.md`];
}

export function siteCacheUrls(siteSlug: string): string[] {
  if (!publicBlogBaseDomain()) return [];
  const base = `https://${defaultHostname(siteSlug)}`;
  return [base, `${base}/feed.xml`, `${base}/rss.xml`, `${base}/atom.xml`, `${base}/sitemap.xml`, `${base}/llms.txt`];
}

async function purgeCache(tags: string[], urls: string[]): Promise<void> {
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
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return;
    }

    const cache = (caches as CacheStorage & { default: Cache }).default;
    for (const url of urls) await cache.delete(new Request(url));
  } catch {
    // fail-open: content mutations must not depend on purge
  }
}

export async function purgeSiteCache(siteId: string, siteSlug: string): Promise<void> {
  await purgeCache([siteCacheTag(siteId)], siteCacheUrls(siteSlug));
}

export async function purgeArticleCache(siteId: string, siteSlug: string, postSlug: string): Promise<void> {
  await purgeCache(
    [siteCacheTag(siteId), articleCacheTag(siteId, postSlug)],
    [...siteCacheUrls(siteSlug), ...articleCacheUrls(siteSlug, postSlug)],
  );
}