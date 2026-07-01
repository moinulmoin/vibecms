import type { BillingStatus, Post } from '@vc/core'
import { createDataAccess } from '@vc/db'
import { env } from 'cloudflare:workers'
import { getBillingStatus } from '~/server/billing'
import { type AppUserContext } from '~/server/onboarding'
import {
  appPublicBlogUrl,
  defaultHostname,
  isLocalDefaultHostname,
  publicBlogBaseDomain,
  publicBlogUsesAppPath,
  publicUrlForHostname,
} from './public-url'
import { getApiUsageSummary, type ApiUsageSummary } from '~/server/usage'

type ActivityRow = { action: string; summary: string; actor_name: string; created_at: number }

export type DashboardData = {
  site: { name: string; slug: string } | null
  publicUrl: string | null
  publicUrlLocal: boolean
  billing: { status: BillingStatus }
  apiUsage: ApiUsageSummary
  counts: { published: number; draft: number; archived: number }
  media: { bytes: number; count: number }
  tokenCount: number
  versionCount: number
  recentPosts: Array<{
    id: string
    title: string
    slug: string
    status: Post['status']
    updatedAt: number
    publishedAt: number | null
  }>
  recentActivity: ActivityRow[]
}

export async function getDashboardData(app: AppUserContext): Promise<DashboardData> {
  const db = createDataAccess(env.DB)
  const agg = await db.dashboard.getDashboardAggregate(app.siteId)

  const [billingStatus, apiUsage] = await Promise.all([
    getBillingStatus(app.workspaceId),
    getApiUsageSummary({ workspaceId: app.workspaceId, siteId: app.siteId }),
  ])

  // One-time repair of a stale local default hostname to the configured slug zone; mirrors site-public-url.ts.
  let hostname = agg.activeDefaultHostname
  if (agg.site && hostname && isLocalDefaultHostname(hostname) && publicBlogBaseDomain()) {
    hostname = await db.sites.repairDefaultHostname({
      siteId: app.siteId,
      currentHostname: hostname,
      newHostname: defaultHostname(agg.site.slug),
    })
  } else if (!agg.site) {
    hostname = null
  }

  return {
    site: agg.site,
    publicUrl: agg.site && publicBlogUsesAppPath() ? appPublicBlogUrl(agg.site.slug) : publicUrlForHostname(hostname),
    publicUrlLocal: hostname ? isLocalDefaultHostname(hostname) : false,
    billing: { status: billingStatus },
    apiUsage,
    counts: agg.counts,
    media: agg.media,
    tokenCount: agg.tokenCount,
    versionCount: agg.versionCount,
    recentPosts: agg.recentPosts,
    recentActivity: agg.recentActivity.map((a) => ({
      action: a.action,
      summary: a.summary,
      actor_name: a.actorName,
      created_at: a.createdAt,
    })),
  }
}