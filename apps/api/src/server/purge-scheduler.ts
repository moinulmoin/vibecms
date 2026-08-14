import { scheduleBackground } from '@/server/execution-scope'
import { createDataAccess, PUBLIC_BLOG_LIMITS } from '@vc/db'
import { purgeArticleCache, purgeHostnameCache, purgeSiteCache } from "./public-blog-cache";

export function scheduleArticlePurge(siteId: string, siteSlug: string, postSlug: string) {
  scheduleBackground(purgeArticleCache(siteId, siteSlug, postSlug))
}

export function scheduleSitePurge(
  siteId: string,
  siteSlug: string,
  postSlugs: readonly string[] = [],
  customHosts: readonly string[] = [],
) {
  scheduleBackground(purgeSiteCache(siteId, siteSlug, postSlugs, customHosts));
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
        const [posts, domains] = await Promise.all([
          data.publicBlog.listPublishedPostSummaries(
            siteId,
            Math.floor(Date.now() / 1000),
            PUBLIC_BLOG_LIMITS.sitemapSummaries,
          ),
          data.domains.listBySite(siteId),
        ])
        await purgeSiteCache(
          siteId,
          siteSlug,
          posts.map((post) => post.slug),
          domains
            .filter((domain) => domain.type === 'custom')
            .map((domain) => domain.hostname),
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
