import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { getBilling, getBillingStatus, isSelfHosted } from '~/server/billing'
import { getActivity } from '~/server/cms'
import { canManageApiKeys, createApiKeyForApp, listApiKeys, revokeApiKeyForApp } from '~/server/api-keys'
import { getMedia } from '~/server/media'
import {
  completeSiteSetupForApp,
  getSiteSettings,
  getSiteSetup,
  updateSiteSettingsForApp,
} from '~/server/onboarding'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

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
  const [site, apiKeys, billing] = await Promise.all([
    getSiteSettings(app),
    listApiKeys(app),
    getBilling(app.workspaceId),
  ])
  const selfHosted = isSelfHosted()
  const isOwner = app.actor.type === 'human' && app.actor.role === 'owner'
  const canManageTokens = canManageApiKeys(app)
  const mcpUrl = `${env.APP_URL}/mcp`
  return {
    site,
    apiKeys,
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
  }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return updateSiteSettingsForApp(app, data)
  })

export const createApiKeyMutation = createServerFn({ method: 'POST' })
  .validator((data: { name: string; actorName: string; preset: 'draft' | 'full' }) => data)
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

export const loadMediaPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  const assets = await getMedia(app)
  return { assets }
})

export const loadActivityPage = createServerFn({ method: 'GET' }).handler(async () => {
  const app = await requireApp()
  const events = await getActivity(app)
  return { events }
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