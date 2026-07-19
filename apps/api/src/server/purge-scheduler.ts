import { scheduleBackground } from '@/server/execution-scope'
import { purgeArticleCache, purgeSiteCache } from "./public-blog-cache";

export function scheduleArticlePurge(siteId: string, siteSlug: string, postSlug: string) {
  scheduleBackground(purgeArticleCache(siteId, siteSlug, postSlug))
}

export function scheduleSitePurge(siteId: string, siteSlug: string) {
  scheduleBackground(purgeSiteCache(siteId, siteSlug));
}