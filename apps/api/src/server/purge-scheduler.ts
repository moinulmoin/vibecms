import { env } from 'cloudflare:workers'
import { scheduleBackground } from '@/server/execution-scope'
import { createDataAccess, PUBLIC_BLOG_LIMITS, type DataAccess } from '@vc/db'
import { purgeArticleCache, purgeHostnameCache, purgeSiteCache, type PublicMountLocation } from "./public-blog-cache";

// Non-default domains are cache mounts: custom domains at the host root,
// subpath mounts under their base path. Any status counts — a just-disabled
// mount still holds stale entries until the URL purge clears them.
async function mountedLocations(data: DataAccess, siteId: string): Promise<PublicMountLocation[]> {
  return (await data.domains.listBySite(siteId))
    .filter((domain) => domain.type !== 'default')
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

export function scheduleManagedSitePurge(
  database: D1Database,
  siteId: string,
  siteSlug: string,
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
          locations,
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
