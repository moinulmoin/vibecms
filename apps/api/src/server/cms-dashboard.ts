import type { BillingStatus, Post } from '@vc/core'
import { createDataAccess, type ActivationPost } from '@vc/db'
import { env } from 'cloudflare:workers'
import { getBillingStatus } from '@/server/billing'
import { resolveEffectiveEntitlementForWorkspace } from '@/server/effective-entitlement'
import type { AppUserContext } from '@/server/onboarding'
import {
  defaultHostname,
  isLocalDefaultHostname,
  publicBlogBaseDomain,
  publicUrlForHostname,
} from './public-url'
import { getApiUsageSummary, type ApiUsageSummary } from '@/server/usage'

type ActivityRow = { action: string; summary: string; actor_name: string; created_at: number }

export type DashboardData = {
  site: { name: string; slug: string } | null
  publicUrl: string | null
  publicUrlLocal: boolean
  billing: {
    status: BillingStatus
    polarStatus: BillingStatus
    effective: boolean
    access: 'self_hosted' | 'hosted_paid' | 'hosted_free'
    source: 'self_hosted' | 'polar' | 'managed_sponsorship' | 'none'
    managed: {
      status: 'active' | 'revoked'
      expiresAt: number | null
      effective: boolean
    } | null
  }
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
  /** Drafts awaiting a human review decision (updatedAt desc, limit 5). */
  recentDrafts: Array<{
    id: string
    title: string
    slug: string
    status: Post['status']
    updatedAt: number
    publishedAt: number | null
  }>
  recentActivity: ActivityRow[]
  activationPost: null | {
    id: string
    title: string
    slug: string
    publishedAt: number
    url: string | null
    actorName: string
  }
}

export async function getDashboardData(app: AppUserContext): Promise<DashboardData> {
  const db = createDataAccess(env.DB)
  const agg = await db.dashboard.getDashboardAggregate(app.siteId)

  const [billingStatus, entitlement, apiUsage] = await Promise.all([
    getBillingStatus(app.workspaceId),
    resolveEffectiveEntitlementForWorkspace(app.workspaceId),
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

  const publicBaseUrl = agg.site ? publicUrlForHostname(hostname) : null
  // activationPost surfaces the durable live agent proof on Overview; the URL is
  // derived from the same live proof and the active public base URL (never fabricated).
  const proof = await db.dashboard.getActivationPost(app.siteId)
  const activationPost = toActivationPost(proof, publicBaseUrl)

  return {
    site: agg.site,
    publicUrl: publicBaseUrl,
    publicUrlLocal: hostname ? isLocalDefaultHostname(hostname) : false,
    billing: {
      status: billingStatus,
      polarStatus: entitlement.rawPolarStatus,
      effective: entitlement.effective,
      access: entitlement.access,
      source: entitlement.source,
      managed: entitlement.managedSponsorship.status
        ? {
            status: entitlement.managedSponsorship.status,
            expiresAt: entitlement.managedSponsorship.expiresAt,
            effective: entitlement.managedSponsorship.active,
          }
        : null,
    },
    apiUsage,
    counts: agg.counts,
    media: agg.media,
    tokenCount: agg.tokenCount,
    versionCount: agg.versionCount,
    recentPosts: agg.recentPosts,
    recentDrafts: agg.recentDrafts,
    recentActivity: agg.recentActivity.map((a) => ({
      action: a.action,
      summary: a.summary,
      actor_name: a.actorName,
      created_at: a.createdAt,
    })),
    activationPost,
  }
}

// Only a live api_key-published post activates the Overview banner. The URL is
// appended when a public base URL resolves; otherwise the proof carries no URL.
function toActivationPost(
  proof: ActivationPost,
  publicBaseUrl: string | null,
): DashboardData['activationPost'] {
  if (proof.state !== 'live') return null
  return {
    id: proof.post.id,
    title: proof.post.title,
    slug: proof.post.slug,
    publishedAt: proof.post.publishedAt,
    url: publicBaseUrl ? `${publicBaseUrl}/${proof.post.slug}` : null,
    actorName: proof.actorName,
  }
}