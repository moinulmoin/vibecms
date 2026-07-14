import { Hono } from 'hono'
import { rejectCrossOriginBrowserPost } from '@/server/csrf'
import { requireAppFromRequest, resolveAppSessionContext } from '@/server/session-context'
import {
  addCustomDomainForApp,
  archivePostForApp,
  clearVoiceProfileForApp,
  completeSiteSetupForApp,
  createApiKeyForApp,
  createCheckoutSessionForApp,
  createPortalSessionForApp,
  createPostForApp,
  getPostVersionForDashboard,
  listPostVersionsForDashboard,
  loadActivityPage,
  loadBillingPage,
  loadConnectPage,
  loadDashboardOverview,
  loadMediaPage,
  loadOnboardingStatus,
  loadPostEditorPage,
  loadPostsPage,
  loadSettingsPage,
  loadSetupPage,
  parsePostPayload,
  publishPostForApp,
  removeCustomDomainForApp,
  restorePostVersionForApp,
  revokeApiKeyForApp,
  updateAssetAltForApp,
  updateSiteSettingsForApp,
  updatePostForApp,
  updateVoiceProfileForApp,
  voiceProfileSettingsInputSchema,
} from '@/server/dashboard-api'
import { jsonAppError } from '@/server/http-errors'

function guardDashboardPost(request: Request): Response | undefined {
  if (request.method !== 'POST') return undefined
  return rejectCrossOriginBrowserPost(request)
}

export const dashboardRoutes = new Hono()

// keyId query is optional; when present it must be a UUID (the api_keys.id shape).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

dashboardRoutes.get('/context', async (c) => {
  const ctx = await resolveAppSessionContext(c.req.raw)
  return c.json({
    googleEnabled: ctx.googleEnabled,
    user: ctx.user,
    app: ctx.app,
    siteSetupComplete: ctx.siteSetupComplete,
    siteDisplayName: ctx.siteDisplayName,
  })
})

dashboardRoutes.get('/overview', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadDashboardOverview(auth.app))
})

dashboardRoutes.get('/setup', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadSetupPage(auth.app))
})

dashboardRoutes.post('/setup', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ name: string; slug: string; description?: string }>()
  return c.json(await completeSiteSetupForApp(auth.app, body))
})

dashboardRoutes.get('/settings', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadSettingsPage(auth.app))
})

dashboardRoutes.post('/settings', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json()
  return c.json(await updateSiteSettingsForApp(auth.app, body))
})

dashboardRoutes.post('/voice-profile', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const parsed = voiceProfileSettingsInputSchema.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ kind: 'error', code: 'validation_error' }, 400)
  return c.json(await updateVoiceProfileForApp(auth.app, parsed.data))
})

dashboardRoutes.post('/voice-profile/clear', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await clearVoiceProfileForApp(auth.app))
})

dashboardRoutes.post('/api-keys', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ name: string; actorName: string; preset: 'draft' | 'publish' | 'full' }>()
  return c.json(await createApiKeyForApp(auth.app, body))
})

dashboardRoutes.post('/api-keys/revoke', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ keyId: string }>()
  return c.json(await revokeApiKeyForApp(auth.app, body.keyId))
})

dashboardRoutes.post('/media/alt', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ assetId: string; altText: string }>()
  return c.json(await updateAssetAltForApp(auth.app, body.assetId, body.altText))
})

dashboardRoutes.post('/domains', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ hostname: string }>()
  return c.json(await addCustomDomainForApp(auth.app, body.hostname))
})

dashboardRoutes.post('/domains/remove', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ domainId: string }>()
  return c.json(await removeCustomDomainForApp(auth.app, body.domainId))
})

dashboardRoutes.get('/media', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadMediaPage(auth.app))
})

dashboardRoutes.get('/activity', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const offset = Number(c.req.query('offset') ?? '0')
  return c.json(await loadActivityPage(auth.app, Number.isFinite(offset) ? offset : 0))
})

dashboardRoutes.get('/connect', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadConnectPage(auth.app))
})

dashboardRoutes.get('/onboarding-status', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const keyId = c.req.query('keyId')
  if (keyId !== undefined && !UUID_RE.test(keyId)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'keyId must be a UUID' } }, 400)
  }
  return c.json(await loadOnboardingStatus(auth.app, keyId))
})

dashboardRoutes.get('/posts', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(
    await loadPostsPage(auth.app, {
      status: c.req.query('status'),
      search: c.req.query('search'),
      offset: Number(c.req.query('offset') ?? '0') || 0,
    }),
  )
})

dashboardRoutes.get('/posts/editor', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadPostEditorPage(auth.app, c.req.query('postId')))
})

dashboardRoutes.post('/posts/create', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json()
  return c.json(await createPostForApp(auth.app, parsePostPayload(body)))
})

dashboardRoutes.post('/posts/update', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string } & Parameters<typeof parsePostPayload>[0]>()
  const { postId, ...rest } = body
  return c.json(await updatePostForApp(auth.app, postId, parsePostPayload(rest)))
})

dashboardRoutes.post('/posts/publish', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string; expectedVersionNumber: number }>()
  return c.json(await publishPostForApp(auth.app, body.postId, body.expectedVersionNumber))
})

dashboardRoutes.post('/posts/archive', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string }>()
  return c.json(await archivePostForApp(auth.app, body.postId))
})

dashboardRoutes.get('/posts/versions', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const postId = c.req.query('postId')
  if (!postId) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'postId required' } }, 400)
  return c.json(await listPostVersionsForDashboard(auth.app, postId))
})

dashboardRoutes.get('/posts/version', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const postId = c.req.query('postId')
  const versionNumber = Number(c.req.query('versionNumber'))
  if (!postId || !Number.isFinite(versionNumber)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'postId and versionNumber required' } }, 400)
  }
  return c.json(await getPostVersionForDashboard(auth.app, postId, versionNumber))
})

dashboardRoutes.post('/posts/versions/restore', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string; versionNumber: number }>()
  return c.json(await restorePostVersionForApp(auth.app, body.postId, body.versionNumber))
})

dashboardRoutes.get('/billing', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadBillingPage(auth.app))
})

dashboardRoutes.post('/billing/checkout', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ interval: 'monthly' | 'yearly' }>()
  return c.json(await createCheckoutSessionForApp(auth.app, body.interval))
})

dashboardRoutes.post('/billing/portal', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await createPortalSessionForApp(auth.app))
})

dashboardRoutes.onError((err, c) => jsonAppError(err, c.get('requestId')))