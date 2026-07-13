import { createServerFn } from '@tanstack/react-start'
import { createDataAccess, type ActivityEventRow } from '@vc/db'
import { env } from 'cloudflare:workers'
import { getBilling, isSelfHosted } from '~/server/billing'
import { getActivity } from '~/server/cms'
import { canManageApiKeys, createApiKeyForApp, listApiKeys, revokeApiKeyForApp } from '~/server/api-keys'
import type { ApiKeyListItem } from '~/server/api-keys'
import { getMedia, updateAssetAltForApp } from '~/server/media'
import {
  completeSiteSetupForApp,
  getSiteSettings,
  getSiteSetup,
  updateSiteSettingsForApp,
} from '~/server/onboarding'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'
import { getSitePublicBaseUrl } from '~/server/site-public-url'
import { addCustomDomainForApp, listCustomDomainsForApp, removeCustomDomainForApp } from '~/server/custom-domains'
import { voiceProfileSettingsInputSchema, type VoiceProfileSettingsInput } from '@vc/validators'
import {
  clearVoiceProfileForApp,
  getVoiceProfileSettings,
  updateVoiceProfileForApp,
} from '~/server/voice-profile'

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
  const [site, voiceProfile, billing, customDomains] = await Promise.all([
    getSiteSettings(app),
    getVoiceProfileSettings(app),
    getBilling(app.workspaceId),
    listCustomDomainsForApp(app),
  ])
  const selfHosted = isSelfHosted()
  const isOwner = app.actor.type === 'human' && app.actor.role === 'owner'
  const mcpUrl = `${env.APP_URL}/mcp`
  const publicBaseUrl = site.slug ? await getSitePublicBaseUrl(app.siteId, site.slug) : null
  return {
    site,
    voiceProfile,
    customDomains,
    billingStatus: billing.status,
    selfHosted,
    isOwner,
    mcpUrl,
    publicBaseUrl,
  }
})

export const updateSiteSettingsMutation = createServerFn({ method: 'POST' })
  .validator((data: {
    name: string
    description?: string
    defaultSeoTitle: string
    defaultSeoDescription?: string
    theme: string
    themeAccent?: string | null
    themeFont?: string | null
    themeMode?: string
  }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return updateSiteSettingsForApp(app, data)
  })

export const updateVoiceProfileMutation = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data as VoiceProfileSettingsInput)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return updateVoiceProfileForApp(app, data)
  })

export const clearVoiceProfileMutation = createServerFn({ method: 'POST' }).handler(async () => {
  const app = await requireApp()
  return clearVoiceProfileForApp(app)
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
    const offset = Math.min(Math.max(data.offset ?? 0, 0), 10_000)
    const fetched = await getActivity(app, ACTIVITY_PAGE_SIZE + 1, offset)
    const hasMore = fetched.length > ACTIVITY_PAGE_SIZE
    return { events: hasMore ? fetched.slice(0, ACTIVITY_PAGE_SIZE) : fetched, hasMore }
  })

export type ConnectPageData = {
  canManage: boolean
  mcpUrl: string
  apiKeys: ApiKeyListItem[]
}

export const loadConnectPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  const canManage = canManageApiKeys(app)
  const apiKeys = await listApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`
  return { canManage, mcpUrl, apiKeys }
})

export type OnboardingConnectStatus = {
  canManage: boolean
  mcpUrl: string
  publicBaseUrl: string | null
  onboardingKey: null | { id: string; name: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }
  connection: 'no_token' | 'waiting' | 'connected' | 'revoked'
  publish: null | {
    state: 'none' | 'live' | 'already_live'
    post?: { id: string; title: string; slug: string; publishedAt: number | null; url: string }
    actor: 'onboarding_agent' | 'human' | 'other_agent' | 'unknown'
  }
}

export const loadOnboardingStatus = createServerFn({ method: 'GET' }).handler(async (): Promise<OnboardingConnectStatus> => {
  const app = await requireApp()
  const canManage = canManageApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`
  const db = createDataAccess(env.DB)

  // Prefer the newest ACTIVE key; only report 'revoked' when there is no active key but the
  // most recent key was revoked. A revoked replacement must not mask an older still-active key.
  const [activeKeyRow, latestKeyRow, siteSlug] = await Promise.all([
    db.apiKeys.latestActive(app.siteId),
    db.apiKeys.latestAny(app.siteId),
    db.sites.getSiteSlug(app.siteId),
  ])

  const publicBaseUrl = siteSlug ? await getSitePublicBaseUrl(app.siteId, siteSlug) : null

  const keyRow = activeKeyRow ?? latestKeyRow
  if (!keyRow) {
    return { canManage, mcpUrl, publicBaseUrl, onboardingKey: null, connection: 'no_token', publish: null }
  }

  const onboardingKey = {
    id: keyRow.id,
    name: keyRow.name,
    createdAt: keyRow.createdAt,
    lastUsedAt: keyRow.lastUsedAt,
    revokedAt: keyRow.revokedAt,
  }

  let connection: OnboardingConnectStatus['connection']
  if (!activeKeyRow) {
    connection = 'revoked'
  } else if (activeKeyRow.lastUsedAt != null && activeKeyRow.lastUsedAt > activeKeyRow.createdAt) {
    connection = 'connected'
  } else {
    connection = 'waiting'
  }

  // Query published posts and post.published activity events in parallel
  const [publishedPosts, publishActivities] = await Promise.all([
    db.dashboard.listPublishedForAttribution(app.siteId, 50),
    db.activity.listBySiteAndAction(app.siteId, 'post.published', 100),
  ])

  // Index activity by post id (first entry wins - DESC order, so newest per post)
  const activityByPostId = new Map<string, ActivityEventRow>()
  for (const a of publishActivities) {
    if (!activityByPostId.has(a.entityId)) activityByPostId.set(a.entityId, a)
  }

  // Only treat a post as 'live' when it is CURRENTLY published, so an agent publish that was
  // later archived does not strand the user in a terminal live reveal with no live post.
  const publishedPostIds = new Set(publishedPosts.map((p) => p.id))
  const agentActivity = publishActivities.find(
    (a) => a.actorId === keyRow.id && a.createdAt >= keyRow.createdAt && publishedPostIds.has(a.entityId),
  )

  let publish: OnboardingConnectStatus['publish']

  if (agentActivity) {
    // Onboarding agent published a post - state = 'live'
    const post = publishedPosts.find((p) => p.id === agentActivity.entityId)
    if (post && publicBaseUrl) {
      publish = {
        state: 'live',
        post: { id: post.id, title: post.title, slug: post.slug, publishedAt: post.publishedAt, url: `${publicBaseUrl}/${post.slug}` },
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
    if (postActivity?.actorType === 'human') {
      actor = 'human'
    } else if (postActivity?.actorType === 'api_key' || postActivity?.actorType === 'agent') {
      actor = 'other_agent'
    } else {
      actor = 'unknown'
    }
    const postEntry = publicBaseUrl
      ? { id: newestPost.id, title: newestPost.title, slug: newestPost.slug, publishedAt: newestPost.publishedAt, url: `${publicBaseUrl}/${newestPost.slug}` }
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
