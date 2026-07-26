import type { Post } from '@vc/core'
import { listPostVersions, getPostVersion } from '@vc/core'
import { resolvePresetId } from '@vc/config'
import { createDataAccess, createD1PostRepository, type ActivationPost } from '@vc/db'
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
import { loadAnalyticsForApp, type AnalyticsRange } from '@/server/analytics'

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

export type OnboardingKey = null | {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export type OnboardingFirstPost =
  | { state: 'waiting' }
  | { state: 'draft'; post: { id: string; title: string; slug: string; updatedAt: number; versionNumber: number } }
  | {
      state: 'live'
      post: { id: string; title: string; slug: string; publishedAt: number; url: string | null }
      actorName: string
    }

export type OnboardingConnectStatus = {
  canManage: boolean
  mcpUrl: string
  publicBaseUrl: string | null
  key: OnboardingKey
  connection: 'no_token' | 'waiting' | 'connected' | 'revoked'
  firstPost: OnboardingFirstPost
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
  const [site, voiceProfile, billing, customDomains, assets] = await Promise.all([
    getSiteSettings(app),
    getVoiceProfileSettings(app),
    getBilling(app.workspaceId),
    listCustomDomainsForApp(app),
    getMedia(app),
  ])
  const selfHosted = isSelfHosted()
  const isOwner = app.actor.type === 'human' && app.actor.role === 'owner'
  const mcpUrl = `${env.APP_URL}/mcp`
  const publicBaseUrl = site.slug ? await getSitePublicBaseUrl(app.siteId, site.slug) : null
  return {
    site,
    voiceProfile,
    customDomains,
    assets,
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

export async function loadAnalyticsPage(app: AppUserContext, rangeDays: AnalyticsRange) {
  return loadAnalyticsForApp(app, rangeDays)
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
  return {
    mode: 'edit' as const,
    post: post as Post | null,
    assets,
    missing: !post,
    presetId,
    currentVersionNumber: post?.currentVersionNumber ?? null,
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

// Maps the read-model activation proof into the API contract shape, appending a
// public URL only when a public base URL resolves (never fabricated).
function toFirstPost(proof: ActivationPost, publicBaseUrl: string | null): OnboardingFirstPost {
  if (proof.state === 'waiting') return { state: 'waiting' }
  if (proof.state === 'draft') {
    return { state: 'draft', post: proof.post }
  }
  const post = {
    id: proof.post.id,
    title: proof.post.title,
    slug: proof.post.slug,
    publishedAt: proof.post.publishedAt,
    url: publicBaseUrl ? `${publicBaseUrl}/${proof.post.slug}` : null,
  }
  return { state: 'live', post, actorName: proof.actorName }
}

export async function loadOnboardingStatus(
  app: AppUserContext,
  keyId?: string,
): Promise<OnboardingConnectStatus> {
  const canManage = canManageApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`
  const db = createDataAccess(env.DB)

  // Resolve exactly one key. When keyId is supplied, fetch that site-scoped row
  // (including revoked) and NEVER fall back to another token. Without keyId,
  // prefer the newest active key, then the newest key of any state.
  const keyRow = keyId
    ? await db.apiKeys.getById(app.siteId, keyId)
    : (await db.apiKeys.latestActive(app.siteId)) ?? (await db.apiKeys.latestAny(app.siteId))

  const [siteSlug, proof] = await Promise.all([
    db.sites.getSiteSlug(app.siteId),
    db.dashboard.getActivationPost(app.siteId),
  ])
  const publicBaseUrl = siteSlug ? await getSitePublicBaseUrl(app.siteId, siteSlug) : null
  const firstPost = toFirstPost(proof, publicBaseUrl)

  if (!keyRow) {
    return { canManage, mcpUrl, publicBaseUrl, key: null, connection: 'no_token', firstPost }
  }

  // Connection is derived from the selected key only. "connected" is any
  // non-null lastUsedAt, so a same-second authenticated use still counts (the
  // old lastUsedAt > createdAt check falsely reported "waiting" within one second).
  let connection: OnboardingConnectStatus['connection']
  if (keyRow.revokedAt != null) connection = 'revoked'
  else if (keyRow.lastUsedAt != null) connection = 'connected'
  else connection = 'waiting'

  return {
    canManage,
    mcpUrl,
    publicBaseUrl,
    key: {
      id: keyRow.id,
      name: keyRow.name,
      createdAt: keyRow.createdAt,
      lastUsedAt: keyRow.lastUsedAt,
      revokedAt: keyRow.revokedAt,
    },
    connection,
    firstPost,
  }
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