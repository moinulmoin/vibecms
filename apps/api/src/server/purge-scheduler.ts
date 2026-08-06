import { scheduleBackground } from '@/server/execution-scope'
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

export function scheduleHostnamePurge(hostname: string, siteId?: string | null) {
  scheduleBackground(purgeHostnameCache(hostname, siteId));
}
