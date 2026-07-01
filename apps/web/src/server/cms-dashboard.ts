import type { BillingStatus, Post } from '@vc/core'
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

type SiteRow = { id: string; name: string; slug: string; description: string | null }
type DomainRow = { hostname: string }
type ActivityRow = { action: string; summary: string; actor_name: string; created_at: number }
type CountRow = { count: number }

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

async function activeDefaultHostname(
  site: { slug: string } | undefined,
  domain: { hostname: string } | undefined,
  siteId: string,
) {
  if (!site || !domain) return null
  if (!isLocalDefaultHostname(domain.hostname) || !publicBlogBaseDomain()) return domain.hostname
  const hostname = defaultHostname(site.slug)
  await env.DB.prepare(
    "UPDATE domains SET hostname = ?, updated_at = ? WHERE site_id = ? AND type = 'default' AND hostname = ?",
  )
    .bind(hostname, Math.floor(Date.now() / 1000), siteId, domain.hostname)
    .run()
  return hostname
}

export async function getDashboardData(app: AppUserContext): Promise<DashboardData> {
  type StatusCountRow = { status: Post['status'] | 'scheduled'; count: number }
  type RecentPostRow = {
    id: string
    title: string
    slug: string
    status: Post['status'] | 'scheduled'
    updated_at: number
    published_at: number | null
  }
  type MediaAggregateRow = { bytes: number; count: number }

  const [siteResult, statusResult, recentPostsResult, mediaResult, tokensResult, versionsResult, activityResult, domainResult] =
    (await env.DB.batch([
      env.DB.prepare('SELECT id, name, slug, description FROM sites WHERE id = ? LIMIT 1').bind(app.siteId),
      env.DB.prepare('SELECT status, COUNT(*) AS count FROM posts WHERE site_id = ? GROUP BY status').bind(
        app.siteId,
      ),
      env.DB.prepare(
        'SELECT id, title, slug, status, updated_at, published_at FROM posts WHERE site_id = ? ORDER BY updated_at DESC LIMIT 5',
      ).bind(app.siteId),
      env.DB.prepare('SELECT COALESCE(SUM(size_bytes),0) AS bytes, COUNT(*) AS count FROM assets WHERE site_id = ?').bind(
        app.siteId,
      ),
      env.DB.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE site_id = ? AND revoked_at IS NULL').bind(app.siteId),
      env.DB.prepare('SELECT COUNT(*) AS count FROM post_versions WHERE site_id = ?').bind(app.siteId),
      env.DB.prepare(
        `SELECT action, summary, actor_name, created_at
       FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT 5`,
      ).bind(app.siteId),
      env.DB.prepare(
        "SELECT hostname FROM domains WHERE site_id = ? AND type='default' AND status='active' LIMIT 1",
      ).bind(app.siteId),
    ])) as [
      D1Result<SiteRow>,
      D1Result<StatusCountRow>,
      D1Result<RecentPostRow>,
      D1Result<MediaAggregateRow>,
      D1Result<CountRow>,
      D1Result<CountRow>,
      D1Result<ActivityRow>,
      D1Result<DomainRow>,
    ]

  const [billingStatus, apiUsage] = await Promise.all([
    getBillingStatus(app.workspaceId),
    getApiUsageSummary({ workspaceId: app.workspaceId, siteId: app.siteId }),
  ])

  const counts: DashboardData['counts'] = { published: 0, draft: 0, archived: 0 }
  for (const row of statusResult.results ?? []) {
    const status = row.status === 'scheduled' ? 'draft' : row.status
    if (status === 'published' || status === 'draft' || status === 'archived') counts[status] += row.count
  }

  const site = siteResult.results?.[0]
  const domain = domainResult.results?.[0]
  const hostname = await activeDefaultHostname(site, domain, app.siteId)
  const media = mediaResult.results?.[0]

  return {
    site: site ? { name: site.name, slug: site.slug } : null,
    publicUrl: site && publicBlogUsesAppPath() ? appPublicBlogUrl(site.slug) : publicUrlForHostname(hostname),
    publicUrlLocal: hostname ? isLocalDefaultHostname(hostname) : false,
    billing: { status: billingStatus },
    apiUsage,
    counts,
    media: { bytes: media?.bytes ?? 0, count: media?.count ?? 0 },
    tokenCount: tokensResult.results?.[0]?.count ?? 0,
    versionCount: versionsResult.results?.[0]?.count ?? 0,
    recentPosts: (recentPostsResult.results ?? []).map((post) => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status === 'scheduled' ? 'draft' : post.status,
      updatedAt: post.updated_at,
      publishedAt: post.published_at,
    })),
    recentActivity: activityResult.results ?? [],
  }
}