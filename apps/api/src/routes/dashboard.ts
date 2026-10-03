import { Hono } from 'hono'
import { ConflictError } from '@vc/core'
import { rejectCrossOriginBrowserPost } from '@/server/csrf'
import { rejectChangedSite, requireAppFromRequest, resolveAppSessionContext } from '@/server/session-context'
import {
  addCustomDomainForApp,
  archivePostForApp,
  unarchivePostForApp,
  clearVoiceProfileForApp,
  completeSiteSetupForApp,
  createApiKeyForApp,
  createCheckoutSessionForApp,
  createPortalSessionForApp,
  createPostForApp,
  deleteArchivedPostForApp,
  deleteSubscriberForApp,
  exportSubscribersCsv,
  getPostVersionForDashboard,
  listPostVersionsForDashboard,
  loadActivityPage,
  loadAnalyticsPage,
  loadConnectPage,
  loadDashboardOverview,
  loadMediaPage,
  loadBillingPage,
  loadOnboardingStatus,
  loadPostEditorPage,
  loadPostsPage,
  loadSubscribersPage,
  loadSettingsPage,
  loadSetupPage,
  parsePostPayload,
  publishPostForApp,
  schedulePostForApp,
  unschedulePostForApp,
  removeCustomDomainForApp,
  restorePostVersionForApp,
  revokeApiKeyForApp,
  updateAssetAltForApp,
  updateNewsletterSettingsForApp,
  updateSiteSettingsForApp,
  updatePostForApp,
  updateVoiceProfileForApp,
  voiceProfileSettingsInputSchema,
} from '@/server/dashboard-api'
import { jsonAppError } from '@/server/http-errors'
import { appSelectionCookie } from '@/server/app-selection'
import { getNewsletterSettingsWithRevisionForApp, loadPersonalization, updatePersonalizationForApp } from '@/server/onboarding'

function guardDashboardPost(request: Request): Response | undefined {
  if (request.method !== 'POST') return undefined
  return rejectCrossOriginBrowserPost(request)
}
function canManageSubscribers(auth: { app: { actor: { type: string; role?: string } } }) {
  return auth.app.actor.type === 'human' && (auth.app.actor.role === 'owner' || auth.app.actor.role === 'editor')
}


export const dashboardRoutes = new Hono()

// keyId query is optional; when present it must be a UUID (the api_keys.id shape).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

dashboardRoutes.get('/context', async (c) => {
  const ctx = await resolveAppSessionContext(c.req.raw)
  return c.json({
    googleEnabled: ctx.googleEnabled,
    githubEnabled: ctx.githubEnabled,
    user: ctx.user,
    app: ctx.app,
    apps: ctx.apps,
    siteSetupComplete: ctx.siteSetupComplete,
    siteDisplayName: ctx.siteDisplayName,
  })
})

dashboardRoutes.post('/context/select', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const ctx = await resolveAppSessionContext(c.req.raw)
  if (!ctx.user) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401,
    )
  }
  const changed = rejectChangedSite(c.req.raw, ctx)
  if (changed) return changed
  const body = await c.req.json<{
    workspaceId?: unknown
    siteId?: unknown
  }>()
  if (
    typeof body.workspaceId !== 'string' ||
    typeof body.siteId !== 'string'
  ) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid app selection' } },
      400,
    )
  }
  const selected = ctx.apps.find(
    (choice) =>
      choice.workspaceId === body.workspaceId &&
      choice.siteId === body.siteId,
  )
  if (!selected) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'App selection is not available' } },
      403,
    )
  }
  c.header(
    'Set-Cookie',
    await appSelectionCookie({
      workspaceId: selected.workspaceId,
      siteId: selected.siteId,
    }),
  )
  return c.json({ ok: true })
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

dashboardRoutes.get('/personalization', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  return c.json(await loadPersonalization(auth.app))
})

dashboardRoutes.post('/personalization', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json()
  return c.json(await updatePersonalizationForApp(auth.app, body))
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
dashboardRoutes.get('/newsletter-settings', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  if (!canManageSubscribers(auth)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Editor access required' } }, 403)
  }
  return c.json(await getNewsletterSettingsWithRevisionForApp(auth.app))
})

dashboardRoutes.put('/newsletter-settings', async (c) => {
  const blocked = rejectCrossOriginBrowserPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const { expectedUpdatedAt, ...settings } = await c.req.json<Record<string, unknown>>()
  if (!Number.isInteger(expectedUpdatedAt) || (expectedUpdatedAt as number) < 1) return c.json({ kind: 'error', code: 'invalid_settings_version' }, 400)
  const result = await updateNewsletterSettingsForApp(auth.app, settings, { expectedUpdatedAt: expectedUpdatedAt as number })
  if (result.code === 'settings_conflict') throw new ConflictError('This changed since you opened it. Reload to see the latest.')
  return c.json(result)
})

dashboardRoutes.get('/subscribers/export.csv', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  if (auth.app.actor.type !== 'human' || auth.app.actor.role !== 'owner') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Owner access required' } }, 403)
  }
  const csv = await exportSubscribersCsv(auth.app)
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="subscribers.csv"',
      'cache-control': 'no-store',
    },
  })
})

dashboardRoutes.get('/subscribers', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  if (!canManageSubscribers(auth)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Editor access required' } }, 403)
  }
  return c.json(await loadSubscribersPage(auth.app, {
    search: c.req.query('q'),
    status: c.req.query('status'),
    offset: Number(c.req.query('offset') ?? '0') || 0,
  }))
})

dashboardRoutes.delete('/subscriber/:id', async (c) => {
  const blocked = rejectCrossOriginBrowserPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  if (!canManageSubscribers(auth)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Editor access required' } }, 403)
  }
  const result = await deleteSubscriberForApp(auth.app, c.req.param('id'))
  return c.json(result)
})

dashboardRoutes.post('/voice-profile', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const { expectedUpdatedAt, ...payload } = await c.req.json<Record<string, unknown>>()
  const parsed = voiceProfileSettingsInputSchema.safeParse(payload)
  if (!parsed.success) return c.json({ kind: 'error', code: 'validation_error' }, 400)
  return c.json(await updateVoiceProfileForApp(auth.app, parsed.data, { expectedUpdatedAt: expectedUpdatedAt as number }))
})

dashboardRoutes.post('/voice-profile/clear', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ expectedUpdatedAt: number }>()
  return c.json(await clearVoiceProfileForApp(auth.app, body))
})

dashboardRoutes.post('/api-keys', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ name: string; actorName: string; preset: 'draft' | 'publish' | 'full' | 'manage' }>()
  return c.json(await createApiKeyForApp(auth.app, body))
})

dashboardRoutes.post('/api-keys/revoke', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ keyId?: unknown }>()
  if (typeof body.keyId !== 'string' || !body.keyId) return c.json({ kind: 'error', code: 'validation_error' }, 400)
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
  const actorParam = c.req.query('actor')
  const actor = actorParam === 'human' || actorParam === 'agent' ? actorParam : undefined
  return c.json(await loadActivityPage(auth.app, Number.isFinite(offset) ? offset : 0, actor))
})

dashboardRoutes.get('/analytics', async (c) => {
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const requestedRange = c.req.query('range') ?? '30'
  const rangeDays = requestedRange === '7'
    ? 7
    : requestedRange === '90'
      ? 90
      : requestedRange === '365'
        ? 365
        : requestedRange === 'all'
          ? 'all'
          : 30
  return c.json(await loadAnalyticsPage(auth.app, rangeDays))
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
      sort: c.req.query('sort'),
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
  const body = await c.req.json<{ postId: string; expectedVersionNumber: number } & Parameters<typeof parsePostPayload>[0]>()
  const { postId, expectedVersionNumber, ...rest } = body
  return c.json(await updatePostForApp(auth.app, postId, parsePostPayload(rest), expectedVersionNumber))
})

dashboardRoutes.post('/posts/publish', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string; expectedVersionNumber: number }>()
  return c.json(await publishPostForApp(auth.app, body.postId, body.expectedVersionNumber))
})

dashboardRoutes.post('/posts/schedule', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string; versionNumber: number; publishAt: number }>()
  return c.json(await schedulePostForApp(auth.app, body.postId, body.versionNumber, body.publishAt))
})

dashboardRoutes.post('/posts/unschedule', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string }>()
  const result = await unschedulePostForApp(auth.app, body.postId)
  if (result.code === 'already_publishing') return c.json({ error: { code: 'CONFLICT', message: 'Already publishing' } }, 409)
  return c.json(result)
})

dashboardRoutes.post('/posts/archive', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string }>()
  return c.json(await archivePostForApp(auth.app, body.postId))
})

dashboardRoutes.post('/posts/unarchive', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId: string }>()
  return c.json(await unarchivePostForApp(auth.app, body.postId))
})

dashboardRoutes.post('/posts/delete', async (c) => {
  const blocked = guardDashboardPost(c.req.raw)
  if (blocked) return blocked
  const auth = await requireAppFromRequest(c.req.raw)
  if ('error' in auth) return auth.error
  const body = await c.req.json<{ postId?: string }>()
  if (!body.postId) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'postId required' } }, 400)
  try {
    return c.json(await deleteArchivedPostForApp(auth.app, body.postId))
  } catch (error) {
    return jsonAppError(error)
  }
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
  const body = await c.req.json<{ postId: string; versionNumber: number; expectedVersionNumber: number }>()
  return c.json(await restorePostVersionForApp(auth.app, body.postId, body.versionNumber, body.expectedVersionNumber))
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
