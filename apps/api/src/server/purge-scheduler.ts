import { scheduleBackground } from '@/server/execution-scope'
import { purgeArticleCache } from '@/server/public-blog-cache'

export function scheduleArticlePurge(siteId: string, siteSlug: string, postSlug: string) {
  scheduleBackground(purgeArticleCache(siteId, siteSlug, postSlug))
}