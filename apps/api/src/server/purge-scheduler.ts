import { env } from 'cloudflare:workers'
import { scheduleBackground } from '@/server/execution-scope'
import { createDataAccess, PUBLIC_BLOG_LIMITS, type DataAccess } from '@vc/db'
import type { DomainRecord } from '@vc/core'
import { purgeArticleCache, purgeHostnameCache, purgeSiteCache, type PublicMountLocation } from "./public-blog-cache";

/**
 * Non-default domains are cache mounts: custom domains at the host root,
 * subpath mounts under their base path. Any status counts — a just-disabled
 * mount still holds stale entries until the URL purge clears them.
 *
 * Exception: a subpath claim that NEVER passed a setup check (not active and
 * `activated_at` unset) was never live, so it never owned a mount. Squatters
 * can park such claims on anyone's hostname; counting them as mounts would
 * let a claim set+remove flush the real owner's hostname-wide cache.
 */
export function isPurgeableMount(domain: Pick<DomainRecord, 'type' | 'status' | 'activatedAt'>): boolean {
  if (domain.type === 'default') return false
  if (domain.type !== 'subpath') return true
  return domain.status === 'active' || domain.activatedAt != null
}

async function mountedLocations(data: DataAccess, siteId: string): Promise<PublicMountLocation[]> {
  return (await data.domains.listBySite(siteId))
    .filter(isPurgeableMount)
    .map((domain) => ({ hostname: domain.hostname, basePath: domain.basePath ?? '' }))
}

export function scheduleArticlePurge(siteId: string, siteSlug: string, postSlug: string) {
  scheduleBackground(
    (async () => {
      const data = createDataAccess(env.DB)
      await purgeArticleCache(siteId, siteSlug, postSlug, await mountedLocations(data, siteId))
    })(),
  )
}

export function scheduleSitePurge(
  siteId: string,
  siteSlug: string,
  postSlugs: readonly string[] = [],
  locations: readonly PublicMountLocation[] = [],
) {
  scheduleBackground(purgeSiteCache(siteId, siteSlug, postSlugs, locations));
}

/** Redirects can have multiple segments, so include their exact paths in the URL fallback. */
export function scheduleRedirectPurge(siteId: string, siteSlug: string, paths: readonly string[]) {
  scheduleBackground(
    (async () => {
      const data = createDataAccess(env.DB);
      const encodedPaths = paths.map((path) => path.slice(1).split("/").map(encodeURIComponent).join("/"));
      await purgeSiteCache(siteId, siteSlug, encodedPaths, await mountedLocations(data, siteId));
    })(),
  );
}

export function scheduleManagedSitePurge(
  database: D1Database,
  siteId: string,
  siteSlug: string,
  // A mount whose domain row was just deleted no longer appears in
  // mountedLocations — callers pass it explicitly so its host still purges.
  removedLocations: readonly PublicMountLocation[] = [],
) {
  scheduleBackground(
    (async () => {
      try {
        const data = createDataAccess(database)
        const [posts, locations] = await Promise.all([
          data.publicBlog.listPublishedPostSummaries(
            siteId,
            Math.floor(Date.now() / 1000),
            PUBLIC_BLOG_LIMITS.sitemapSummaries,
          ),
          mountedLocations(data, siteId),
        ])
        await purgeSiteCache(
          siteId,
          siteSlug,
          posts.map((post) => post.slug),
          [...locations, ...removedLocations],
        )
      } catch (error) {
        console.warn('managed public cache purge failed', error)
      }
    })(),
  )
}
export function scheduleHostnamePurge(hostname: string, siteId?: string | null) {
  scheduleBackground(purgeHostnameCache(hostname, siteId));
}
