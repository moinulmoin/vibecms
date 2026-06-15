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