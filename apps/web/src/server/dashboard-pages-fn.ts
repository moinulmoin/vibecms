import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getBilling, getBillingStatus, isSelfHosted } from '~/server/billing'
import { getActivity } from '~/server/cms'
import { canManageApiKeys, createApiKeyForApp, listApiKeys, revokeApiKeyForApp } from '~/server/api-keys'
import { getMedia, updateAssetAltForApp } from '~/server/media'
import {
  completeSiteSetupForApp,
  getSiteSettings,
  getSiteSetup,
  updateSiteSettingsForApp,
} from '~/server/onboarding'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'
import { getSitePublicBaseUrl } from '~/server/cms-dashboard'
import { addCustomDomainForApp, listCustomDomainsForApp, removeCustomDomainForApp } from '~/server/custom-domains'

async function requireApp() {
  const ctx = await resolveAppRouterContext()
  if (!ctx.app) throw new Error('UNAUTHORIZED')
  return ctx.app
}

export const loadSetupPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  return getSiteSetup(app)
})

export const completeSetupMutation = createServerFn({ method: 'POST' })
  .validator((data: { name: string; slug: string; description?: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return completeSiteSetupForApp(app, data)
  })

export const loadSettingsPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  const [site, apiKeys, billing, customDomains] = await Promise.all([
    getSiteSettings(app),
    listApiKeys(app),
    getBilling(app.workspaceId),
    listCustomDomainsForApp(app),
  ])
  const selfHosted = isSelfHosted()
  const isOwner = app.actor.type === 'human' && app.actor.role === 'owner'
  const canManageTokens = canManageApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`
  return {
    site,
    apiKeys,
    customDomains,
    billingStatus: billing.status,
    selfHosted,
    isOwner,
    canManageTokens,
    mcpUrl,
  }
})

export const updateSiteSettingsMutation = createServerFn({ method: 'POST' })
  .validator((data: {
    name: string
    description?: string
    defaultSeoTitle: string
    defaultSeoDescription?: string
    theme: string
  }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return updateSiteSettingsForApp(app, data)
  })

export const createApiKeyMutation = createServerFn({ method: 'POST' })
  .validator((data: { name: string; actorName: string; preset: 'draft' | 'publish' | 'full' }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return createApiKeyForApp(app, data)
  })

export const revokeApiKeyMutation = createServerFn({ method: 'POST' })
  .validator((data: { keyId: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return revokeApiKeyForApp(app, data.keyId)
  })

export const updateMediaAltMutation = createServerFn({ method: 'POST' })
  .validator((data: { assetId: string; altText: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return updateAssetAltForApp(app, data.assetId, data.altText)
  })

export const addCustomDomainMutation = createServerFn({ method: 'POST' })
  .validator((data: { hostname: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return addCustomDomainForApp(app, data.hostname)
  })

export const removeCustomDomainMutation = createServerFn({ method: 'POST' })
  .validator((data: { domainId: string }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return removeCustomDomainForApp(app, data.domainId)
  })

export const loadMediaPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  const assets = await getMedia(app)
  return { assets }
})

const ACTIVITY_PAGE_SIZE = 25

export const loadActivityPage = createServerFn({ method: 'GET' })
  .validator((data?: { offset?: number }) => data ?? {})
  .handler(async ({ data }) => {
    const app = await requireApp()
    const offset = Math.max(data.offset ?? 0, 0)
    const fetched = await getActivity(app, ACTIVITY_PAGE_SIZE + 1, offset)
    const hasMore = fetched.length > ACTIVITY_PAGE_SIZE
    return { events: hasMore ? fetched.slice(0, ACTIVITY_PAGE_SIZE) : fetched, hasMore }
  })

export const loadConnectPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  const canManage = canManageApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`
  return { canManage, mcpUrl }
})

export const loadBillingRequiredPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  const isOwner = app.actor.type === 'human' && app.actor.role === 'owner'
  if (isSelfHosted()) return { redirectToApp: true as const, billingStatus: 'active' as const, isOwner }
  const billingStatus = await getBillingStatus(app.workspaceId)
  return { redirectToApp: false as const, billingStatus, isOwner }
})

export type OnboardingConnectStatus = {
  canManage: boolean
  mcpUrl: string
  publicBaseUrl: string | null
  onboardingKey: null | { id: string; name: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }
  connection: 'no_token' | 'waiting' | 'connected' | 'revoked'
  publish: null | {
    state: 'none' | 'live' | 'already_live'
    post?: { id: string; title: string; slug: string; publishedAt: number; url: string }
    actor: 'onboarding_agent' | 'human' | 'other_agent' | 'unknown'
  }
}

export const loadOnboardingStatus = createServerFn({ method: 'GET' }).handler(async (): Promise<OnboardingConnectStatus> => {
  const app = await requireApp()
  const canManage = canManageApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`

  type KeyRow = {
    id: string
    name: string
    created_at: number
    last_used_at: number | null
    revoked_at: number | null
  }
  type PublishedPostRow = { id: string; title: string; slug: string; published_at: number }
  type PublishActivityRow = { entity_id: string; actor_id: string; actor_type: string; created_at: number }

  // Prefer the newest ACTIVE key; only report 'revoked' when there is no active key but the
  // most recent key was revoked. A revoked replacement must not mask an older still-active key.
  const [activeKeyRow, latestKeyRow, siteRow] = await Promise.all([
    env.DB.prepare(
      'SELECT id, name, created_at, last_used_at, revoked_at FROM api_keys WHERE site_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
    ).bind(app.siteId).first<KeyRow>(),
    env.DB.prepare(
      'SELECT id, name, created_at, last_used_at, revoked_at FROM api_keys WHERE site_id = ? ORDER BY created_at DESC LIMIT 1',
    ).bind(app.siteId).first<KeyRow>(),
    env.DB.prepare('SELECT slug FROM sites WHERE id = ? LIMIT 1').bind(app.siteId).first<{ slug: string }>(),
  ])

  const publicBaseUrl = siteRow ? await getSitePublicBaseUrl(app.siteId, siteRow.slug) : null

  const keyRow = activeKeyRow ?? latestKeyRow
  if (!keyRow) {
    return { canManage, mcpUrl, publicBaseUrl, onboardingKey: null, connection: 'no_token', publish: null }
  }

  const onboardingKey = {
    id: keyRow.id,
    name: keyRow.name,
    createdAt: keyRow.created_at,
    lastUsedAt: keyRow.last_used_at,
    revokedAt: keyRow.revoked_at,
  }

  let connection: OnboardingConnectStatus['connection']
  if (!activeKeyRow) {
    connection = 'revoked'
  } else if (activeKeyRow.last_used_at != null && activeKeyRow.last_used_at > activeKeyRow.created_at) {
    connection = 'connected'
  } else {
    connection = 'waiting'
  }

  // Query published posts and post.published activity events in parallel
  const [postsResult, activityResult] = await Promise.all([
    env.DB.prepare(
      "SELECT id, title, slug, published_at FROM posts WHERE site_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT 50",
    ).bind(app.siteId).all<PublishedPostRow>(),
    env.DB.prepare(
      "SELECT entity_id, actor_id, actor_type, created_at FROM activity_events WHERE site_id = ? AND action = 'post.published' ORDER BY created_at DESC LIMIT 100",
    ).bind(app.siteId).all<PublishActivityRow>(),
  ])

  const publishedPosts = postsResult.results ?? []
  const publishActivities = activityResult.results ?? []

  // Index activity by post id (first entry wins - DESC order, so newest per post)
  const activityByPostId = new Map<string, PublishActivityRow>()
  for (const a of publishActivities) {
    if (!activityByPostId.has(a.entity_id)) activityByPostId.set(a.entity_id, a)
  }

  // Only treat a post as 'live' when it is CURRENTLY published, so an agent publish that was
  // later archived does not strand the user in a terminal live reveal with no live post.
  const publishedPostIds = new Set(publishedPosts.map((p) => p.id))
  const agentActivity = publishActivities.find(
    (a) => a.actor_id === keyRow.id && a.created_at >= keyRow.created_at && publishedPostIds.has(a.entity_id),
  )

  let publish: OnboardingConnectStatus['publish']

  if (agentActivity) {
    // Onboarding agent published a post - state = 'live'
    const post = publishedPosts.find((p) => p.id === agentActivity.entity_id)
    if (post && publicBaseUrl) {
      publish = {
        state: 'live',
        post: { id: post.id, title: post.title, slug: post.slug, publishedAt: post.published_at, url: `${publicBaseUrl}/${post.slug}` },
        actor: 'onboarding_agent',
      }
    } else {
      publish = { state: 'live', actor: 'onboarding_agent' }
    }
  } else if (publishedPosts.length > 0) {
    // Published posts exist but none from the onboarding agent - state = 'already_live'
    const newestPost = publishedPosts[0]
    const postActivity = activityByPostId.get(newestPost.id)
    let actor: 'human' | 'other_agent' | 'unknown'
    if (postActivity?.actor_type === 'human') {
      actor = 'human'
    } else if (postActivity?.actor_type === 'api_key' || postActivity?.actor_type === 'agent') {
      actor = 'other_agent'
    } else {
      actor = 'unknown'
    }
    const postEntry = publicBaseUrl
      ? { id: newestPost.id, title: newestPost.title, slug: newestPost.slug, publishedAt: newestPost.published_at, url: `${publicBaseUrl}/${newestPost.slug}` }
      : undefined
    publish = { state: 'already_live', ...(postEntry ? { post: postEntry } : {}), actor }
  } else {
    // No published posts yet: the first publish is free (FREE_PUBLISHED_LIMIT = 1, counted by
    // current published posts in publishPostWithHistory), so prompt the agent to publish
    // regardless of billing status. This is the activation moment of the value-first flow.
    publish = { state: 'none', actor: 'unknown' }
  }

  return { canManage, mcpUrl, publicBaseUrl, onboardingKey, connection, publish }
})