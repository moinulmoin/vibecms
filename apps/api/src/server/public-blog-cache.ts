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

/** Best-effort Cache API keys for a custom hostname (CF `hosts` purge is authoritative). */
export function hostnameCacheUrls(hostname: string): string[] {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return [];
  const base = `https://${host}`;
  return [base, `${base}/feed.xml`, `${base}/rss.xml`, `${base}/atom.xml`, `${base}/sitemap.xml`, `${base}/llms.txt`];
}

async function purgeCloudflare(body: Record<string, unknown>): Promise<boolean> {
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const token = env.CACHE_PURGE_API_TOKEN;
  if (!zoneId || !token) return false;
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  return res.ok;
}

async function purgeCacheApi(urls: string[]): Promise<void> {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  for (const url of urls) await cache.delete(new Request(url));
}

async function purgeCache(tags: string[], urls: string[], hosts: string[] = []): Promise<void> {
  try {
    // Cloudflare accepts only one purge selector per request.
    if (hosts.length > 0) {
      const hostsOk = await purgeCloudflare({ hosts });
      // Companion site-tag purge helps when the prior tenant's tagged responses remain.
      if (tags.length > 0) await purgeCloudflare({ tags });
      if (hostsOk) return;
      await purgeCacheApi(urls);
      return;
    }
    if (tags.length > 0 && (await purgeCloudflare({ tags }))) return;
    await purgeCacheApi(urls);
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

/**
 * Invalidate cached public responses for a hostname ownership transition.
 * Prefer Cloudflare `hosts` purge (clears every URL on that host); also purge
 * the prior site's tag when known. Cache API fallback covers site-level URLs.
 */
export async function purgeHostnameCache(hostname: string, siteId?: string | null): Promise<void> {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return;
  const tags = siteId ? [siteCacheTag(siteId)] : [];
  await purgeCache(tags, hostnameCacheUrls(host), [host]);
}
