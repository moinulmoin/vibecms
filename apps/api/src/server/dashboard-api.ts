import type { Post } from '@vc/core'
import { listPostVersions, getPostVersion } from '@vc/core'
import { resolvePresetId } from '@vc/config'
import { createDataAccess, createD1PostRepository, type ActivityEventRow } from '@vc/db'
import { env } from 'cloudflare:workers'
import {
  createCheckoutSessionForApp,
  createPortalSessionForApp,
  getBilling,
  isSelfHosted,
  type CheckoutInterval,
} from '@/server/billing'
import { getActivity } from '@/server/cms'
import { getDashboardData } from '@/server/cms-dashboard'
import {
  canManageApiKeys,
  createApiKeyForApp,
  listApiKeys,
  revokeApiKeyForApp,
  type ApiKeyListItem,
} from '@/server/api-keys'
import { getMedia, updateAssetAltForApp } from '@/server/media'
import {
  completeSiteSetupForApp,
  getSiteSettings,
  getSiteSetup,
  updateSiteSettingsForApp,
} from '@/server/onboarding'
import { getSitePublicBaseUrl } from '@/server/site-public-url'
import { addCustomDomainForApp, listCustomDomainsForApp, removeCustomDomainForApp } from '@/server/custom-domains'
import { voiceProfileSettingsInputSchema, type VoiceProfileSettingsInput } from '@vc/validators'
import { clearVoiceProfileForApp, getVoiceProfileSettings, updateVoiceProfileForApp } from '@/server/voice-profile'
import type { AppUserContext } from '@/server/onboarding'
import { getPosts } from '@/server/cms'
import {
  archivePostForApp,
  createPostForApp,
  publishPostForApp,
  restorePostVersionForApp,
  updatePostForApp,
  type PostFormPayload,
} from '@/server/post-mutations'

const POSTS_PAGE_SIZE = 24
const ACTIVITY_PAGE_SIZE = 25

export interface DashboardPostSummary {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverAssetId: string | null
  status: Post['status']
  publishedAt: number | null
  tags: string[]
  createdAt: number
  updatedAt: number
  versionNumber: number | null
}

export type ConnectPageData = {
  canManage: boolean
  mcpUrl: string
  apiKeys: ApiKeyListItem[]
}

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

function postRepository() {
  return createD1PostRepository(env.DB)
}

function parseTags(raw: string | undefined) {
  if (!raw?.trim()) return [] as string[]
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function parsePostPayload(data: {
  title: string
  slug: string
  excerpt?: string
  contentMarkdown: string
  coverAssetId?: string | null
  canonicalUrl?: string | null
  seoTitle?: string
  seoDescription?: string
  tags?: string
  presentation?: { layout?: string; toc?: boolean } | null
}): PostFormPayload {
  return {
    title: data.title,
    slug: data.slug,
    excerpt: data.excerpt,
    contentMarkdown: data.contentMarkdown,
    coverAssetId: data.coverAssetId,
    canonicalUrl: data.canonicalUrl,
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
    tags: parseTags(data.tags),
    presentation: data.presentation,
  }
}

export async function loadDashboardOverview(app: AppUserContext) {
  return getDashboardData(app)
}

export async function loadSetupPage(app: AppUserContext) {
  return getSiteSetup(app)
}

export async function loadSettingsPage(app: AppUserContext) {
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
}

export async function loadMediaPage(app: AppUserContext) {
  return { assets: await getMedia(app) }
}

export async function loadActivityPage(app: AppUserContext, offset = 0) {
  const safeOffset = Math.min(Math.max(offset, 0), 10_000)
  const fetched = await getActivity(app, ACTIVITY_PAGE_SIZE + 1, safeOffset)
  const hasMore = fetched.length > ACTIVITY_PAGE_SIZE
  return { events: hasMore ? fetched.slice(0, ACTIVITY_PAGE_SIZE) : fetched, hasMore }
}

export async function loadConnectPage(app: AppUserContext): Promise<ConnectPageData> {
  const canManage = canManageApiKeys(app)
  const apiKeys = await listApiKeys(app)
  return { canManage, mcpUrl: `${env.APP_URL}/mcp`, apiKeys }
}

export async function loadPostsPage(
  app: AppUserContext,
  input: { status?: string; search?: string; offset?: number },
) {
  const status =
    input.status === 'draft' || input.status === 'published' || input.status === 'archived'
      ? input.status
      : undefined
  const offset = Math.min(Math.max(input.offset ?? 0, 0), 10_000)
  const fetched = await getPosts(app, status, input.search?.trim() || undefined, POSTS_PAGE_SIZE + 1, offset)
  const repo = postRepository()
  const postsWithVersions: DashboardPostSummary[] = await Promise.all(
    fetched.map(async (post) => {
      const versions = await listPostVersions(repo, app.actor, { siteId: app.siteId, postId: post.id })
      return { ...post, versionNumber: versions[0]?.versionNumber ?? null }
    }),
  )
  const hasMore = postsWithVersions.length > POSTS_PAGE_SIZE
  return { posts: hasMore ? postsWithVersions.slice(0, POSTS_PAGE_SIZE) : postsWithVersions, hasMore }
}

export async function loadPostEditorPage(app: AppUserContext, postId?: string) {
  const assets = await getMedia(app)
  const theme = await createDataAccess(env.DB).sites.getSiteTheme(app.siteId)
  const presetId = resolvePresetId(theme)
  if (!postId) {
    return { mode: 'new' as const, post: null, assets, missing: false, presetId, currentVersionNumber: null }
  }
  const repo = postRepository()
  const post = await repo.getPost(app.siteId, postId)
  let currentVersionNumber: number | null = null
  if (post) {
    const versions = await repo.listPostVersions(app.siteId, postId)
    currentVersionNumber = versions[0]?.versionNumber ?? null
  }
  return {
    mode: 'edit' as const,
    post: post as Post | null,
    assets,
    missing: !post,
    presetId,
    currentVersionNumber,
  }
}

export async function loadBillingPage(app: AppUserContext) {
  const isOwner = app.actor.type === 'human' && app.actor.role === 'owner'
  if (isSelfHosted()) {
    return {
      selfHosted: true as const,
      isOwner,
      billing: { status: 'active' as const, currentPeriodEnd: null },
    }
  }
  const billing = await getBilling(app.workspaceId)
  return { selfHosted: false as const, isOwner, billing }
}

export async function loadOnboardingStatus(app: AppUserContext): Promise<OnboardingConnectStatus> {
  const canManage = canManageApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`
  const db = createDataAccess(env.DB)
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
  if (!activeKeyRow) connection = 'revoked'
  else if (activeKeyRow.lastUsedAt != null && activeKeyRow.lastUsedAt > activeKeyRow.createdAt) connection = 'connected'
  else connection = 'waiting'

  const [publishedPosts, publishActivities] = await Promise.all([
    db.dashboard.listPublishedForAttribution(app.siteId, 50),
    db.activity.listBySiteAndAction(app.siteId, 'post.published', 100),
  ])
  const activityByPostId = new Map<string, ActivityEventRow>()
  for (const a of publishActivities) {
    if (!activityByPostId.has(a.entityId)) activityByPostId.set(a.entityId, a)
  }
  const publishedPostIds = new Set(publishedPosts.map((p) => p.id))
  const agentActivity = publishActivities.find(
    (a) => a.actorId === keyRow.id && a.createdAt >= keyRow.createdAt && publishedPostIds.has(a.entityId),
  )
  let publish: OnboardingConnectStatus['publish']
  if (agentActivity) {
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
    const newestPost = publishedPosts[0]
    const postActivity = activityByPostId.get(newestPost.id)
    let actor: 'human' | 'other_agent' | 'unknown'
    if (postActivity?.actorType === 'human') actor = 'human'
    else if (postActivity?.actorType === 'api_key' || postActivity?.actorType === 'agent') actor = 'other_agent'
    else actor = 'unknown'
    const postEntry = publicBaseUrl
      ? { id: newestPost.id, title: newestPost.title, slug: newestPost.slug, publishedAt: newestPost.publishedAt, url: `${publicBaseUrl}/${newestPost.slug}` }
      : undefined
    publish = { state: 'already_live', ...(postEntry ? { post: postEntry } : {}), actor }
  } else {
    publish = { state: 'none', actor: 'unknown' }
  }
  return { canManage, mcpUrl, publicBaseUrl, onboardingKey, connection, publish }
}

export {
  completeSiteSetupForApp,
  updateSiteSettingsForApp,
  updateVoiceProfileForApp,
  clearVoiceProfileForApp,
  createApiKeyForApp,
  revokeApiKeyForApp,
  updateAssetAltForApp,
  addCustomDomainForApp,
  removeCustomDomainForApp,
  createPostForApp,
  updatePostForApp,
  publishPostForApp,
  archivePostForApp,
  restorePostVersionForApp,
  createCheckoutSessionForApp,
  createPortalSessionForApp,
  voiceProfileSettingsInputSchema,
  type VoiceProfileSettingsInput,
  type CheckoutInterval,
}

export async function listPostVersionsForDashboard(app: AppUserContext, postId: string) {
  return listPostVersions(postRepository(), app.actor, { siteId: app.siteId, postId })
}

export async function getPostVersionForDashboard(app: AppUserContext, postId: string, versionNumber: number) {
  return getPostVersion(postRepository(), app.actor, { siteId: app.siteId, postId, versionNumber })
}