import type { Actor } from '@vc/core'
import { listCustomDomains } from '@vc/core'
import { resolveAccent, resolveFont, resolveMode, resolvePresetId } from '@vc/config'
import { createDataAccess, createD1DomainRepository, PUBLIC_BLOG_LIMITS } from '@vc/db'
import { isReservedSiteSlug, newsletterSettingsSchema, type NewsletterSettings } from '@vc/validators'
import { env } from 'cloudflare:workers'
import { ensureBillingRow } from '@/server/billing'
import { defaultHostname } from './public-url'
import { scheduleSitePurge } from './purge-scheduler'

type AuthSessionUser = { id: string; name: string; email: string }

export type AppChoice = {
  workspaceId: string
  workspaceName: string
  siteId: string
  siteName: string
  siteSlug: string
  role: 'owner' | 'editor' | 'viewer'
  managed: {
    status: 'active' | 'revoked'
    expiresAt: number | null
    effective: boolean
  } | null
}

export type AppUserContext = {
  user: AuthSessionUser
  siteId: string
  workspaceId: string
  actor: Actor
}

type UserAppChoice = AppChoice & {
  setupComplete: boolean
}

function now() {
  return Math.floor(Date.now() / 1000)
}

export function canManageSiteSettings(app: AppUserContext) {
  return app.actor.type === 'human' && app.actor.role === 'owner'
}

function slugify(input: string) {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 42)
  return slug || 'site'
}

function appFromChoice(
  user: AuthSessionUser,
  choice: UserAppChoice,
): AppUserContext {
  return {
    user,
    siteId: choice.siteId,
    workspaceId: choice.workspaceId,
    actor: {
      type: 'human',
      id: user.id,
      name: user.name || user.email,
      role: choice.role,
    },
  }
}

export async function listUserAppChoices(
  userId: string,
  timestamp = now(),
): Promise<UserAppChoice[]> {
  const rows = await createDataAccess(env.DB).sites.listAccessibleApps(userId)
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    siteId: row.siteId,
    siteName: row.siteName,
    siteSlug: row.siteSlug,
    role: row.role,
    setupComplete: row.setupComplete,
    managed: row.managedStatus
      ? {
          status: row.managedStatus,
          expiresAt: row.managedExpiresAt,
          effective:
            row.managedStatus === 'active' &&
            (row.managedExpiresAt === null || row.managedExpiresAt > timestamp),
        }
      : null,
  }))
}

function publicAppChoice(choice: UserAppChoice): AppChoice {
  return {
    workspaceId: choice.workspaceId,
    workspaceName: choice.workspaceName,
    siteId: choice.siteId,
    siteName: choice.siteName,
    siteSlug: choice.siteSlug,
    role: choice.role,
    managed: choice.managed,
  }
}

export async function ensureOnboarding(user: AuthSessionUser): Promise<AppUserContext> {
  const existing = await listUserAppChoices(user.id)
  if (existing[0]) return appFromChoice(user, existing[0])
  const timestamp = now()
  const workspaceId = `workspace_${user.id}`
  const siteId = `site_${user.id}`
  const baseSlug = slugify(user.name || user.email.split('@')[0] || user.id)
  const siteSlug = `${baseSlug}-${user.id.slice(0, 8).toLowerCase()}`

  const db = createDataAccess(env.DB)
  await db.sites.ensureOnboardingBase({
    timestamp,
    workspace: {
      id: workspaceId,
      name: `${user.name || 'My'} Workspace`,
      slug: `workspace-${user.id}`,
    },
    membership: { id: `membership_${user.id}`, workspaceId, userId: user.id },
    site: {
      id: siteId,
      workspaceId,
      name: `${user.name || 'My'} Blog`,
      slug: siteSlug,
      description: 'A clean blog for you and your agents.',
    },
    defaultDomain: { id: `domain_${user.id}`, siteId, hostname: defaultHostname(siteSlug) },
    siteCreatedActivity: {
      id: `activity_site_created_${user.id}`,
      siteId,
      summary: 'Created site during onboarding',
    },
  })
  await ensureBillingRow(workspaceId, 'none')

  const role = await db.sites.getMembershipRole(workspaceId, user.id)
  const actor: Actor = {
    type: 'human',
    id: user.id,
    name: user.name || user.email,
    role: role ?? 'viewer',
  }

  return { user, siteId, workspaceId, actor }
}

export async function resolveUserAppContext(
  user: AuthSessionUser,
  selection?: { workspaceId: string; siteId: string } | null,
): Promise<{ app: AppUserContext; apps: AppChoice[] }> {
  let apps = await listUserAppChoices(user.id)
  if (apps.length === 0) {
    const app = await ensureOnboarding(user)
    apps = await listUserAppChoices(user.id)
    return { app, apps: apps.map(publicAppChoice) }
  }
  const selected =
    (selection
      ? apps.find(
          (choice) =>
            choice.workspaceId === selection.workspaceId &&
            choice.siteId === selection.siteId,
        )
      : null) ??
    apps.find((choice) => choice.managed !== null || choice.setupComplete) ??
    apps[0]!
  return {
    app: appFromChoice(user, selected),
    apps: apps.map(publicAppChoice),
  }
}

export async function getSiteSetup(app: AppUserContext) {
  const db = createDataAccess(env.DB)
  const site = await db.sites.getSiteSetup(app.siteId)
  return {
    name: site?.name ?? 'My Blog',
    slug: site?.slug ?? 'my-blog',
    description: site?.description ?? '',
    isComplete: Boolean(site?.defaultSeoTitle),
  }
}

export type CompleteSiteSetupPayload = {
  name: string
  slug: string
  description?: string
}

// Agent identity codes the client-choice step collects; anything outside
// this set is stored as null (including "I'd rather not say").

export const AGENT_PREFERENCES = ['claude_code', 'codex', 'cursor', 'droid', 'other'] as const
export type AgentPreference = (typeof AGENT_PREFERENCES)[number]

export type SitePersonalizationPayload = {
  agentPreference?: string | null
  voiceSeed?: string[]
  onboardingNote?: string | null
}

export type SitePersonalization = {
  agentPreference: AgentPreference | null
  voiceSeed: string[]
  onboardingNote: string | null
}

function sanitizeAgentPreference(raw: string | null | undefined): AgentPreference | null {
  return AGENT_PREFERENCES.find((value) => value === raw) ?? null
}

function sanitizeVoiceSeed(raw: string[] | undefined): string[] {
  if (!Array.isArray(raw)) return []
  const urls: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim().slice(0, 2000)
    if (!trimmed) continue
    let url: URL
    try {
      url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    const normalized = url.toString()
    if (!urls.includes(normalized)) urls.push(normalized)
    if (urls.length >= 3) break
  }
  return urls
}

export async function loadPersonalization(app: AppUserContext): Promise<SitePersonalization> {
  const row = await createDataAccess(env.DB).sites.getSitePersonalization(app.siteId)
  return {
    agentPreference: sanitizeAgentPreference(row?.agentPreference),
    voiceSeed: sanitizeVoiceSeed(safeParseStringArray(row?.voiceSeedJson)),
    onboardingNote: row?.onboardingNote ?? null,
  }
}

function safeParseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export async function updatePersonalizationForApp(
  app: AppUserContext,
  payload: SitePersonalizationPayload,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  if (!canManageSiteSettings(app)) return { kind: 'error', code: 'owner_required' }
  const timestamp = now()
  const sites = createDataAccess(env.DB).sites
  const current = await sites.getSitePersonalization(app.siteId)
  await sites.updateSitePersonalization({
    timestamp,
    siteId: app.siteId,
    agentPreference: payload.agentPreference === undefined
      ? current?.agentPreference ?? null
      : sanitizeAgentPreference(payload.agentPreference),
    voiceSeed: payload.voiceSeed === undefined
      ? sanitizeVoiceSeed(safeParseStringArray(current?.voiceSeedJson))
      : sanitizeVoiceSeed(payload.voiceSeed),
    onboardingNote: payload.onboardingNote === undefined
      ? current?.onboardingNote ?? null
      : payload.onboardingNote?.trim().slice(0, 500) || null,
    activity: {
      id: `activity_site_personalization_${app.user.id}_${timestamp}_${crypto.randomUUID()}`,
      actorType: app.actor.type,
      actorId: app.actor.id,
      actorName: app.actor.name,
      action: 'site.updated',
      summary: 'Updated agent onboarding preferences',
    },
  })
  return { kind: 'ok', code: 'personalization_saved' }
}

export const DEFAULT_NEWSLETTER_SETTINGS: NewsletterSettings = {
  enabled: true,
  heading: 'Get new posts by email',
  subtext: "Email delivery is coming soon. Join now and we'll let you know when it launches.",
  buttonLabel: 'Notify me',
}

function parseNewsletterSettings(raw: string | null | undefined): NewsletterSettings {
  if (!raw) return DEFAULT_NEWSLETTER_SETTINGS
  try {
    const parsed = newsletterSettingsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_NEWSLETTER_SETTINGS
  } catch {
    return DEFAULT_NEWSLETTER_SETTINGS
  }
}

export async function getNewsletterSettingsForApp(app: AppUserContext): Promise<NewsletterSettings> {
  const raw = await createDataAccess(env.DB).sites.getSiteNewsletterSettings(app.siteId)
  return parseNewsletterSettings(raw)
}

export async function updateNewsletterSettingsForApp(
  app: AppUserContext,
  payload: unknown,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  if (!canManageSiteSettings(app)) return { kind: 'error', code: 'owner_required' }
  const parsed = newsletterSettingsSchema.safeParse(payload)
  if (!parsed.success) return { kind: 'error', code: 'validation_error' }
  const timestamp = now()
  const db = createDataAccess(env.DB)
  const currentSite = await db.sites.getSiteSettings(app.siteId)
  await db.sites.updateNewsletterSettings({
    timestamp,
    siteId: app.siteId,
    newsletterSettings: JSON.stringify(parsed.data),
    activity: {
      id: crypto.randomUUID(),
      actorType: app.actor.type,
      actorId: app.actor.id,
      actorName: app.actor.name,
      action: 'site.updated',
      summary: 'Updated newsletter settings',
    },
  })
  if (currentSite) {
    const published = await db.publicBlog.listPublishedPostSummaries(
      app.siteId,
      timestamp,
      PUBLIC_BLOG_LIMITS.sitemapSummaries,
    )
    const domainRows = await listCustomDomains(createD1DomainRepository(env.DB), app.siteId)
    scheduleSitePurge(
      app.siteId,
      currentSite.slug,
      published.map((row) => row.slug),
      domainRows.map((domain) => domain.hostname).filter(Boolean),
    )
  }
  return { kind: 'ok', code: 'newsletter_saved' }
}

export type SiteSettingsPayload = {
  expectedUpdatedAt: number
  name?: string
  description?: string | null
  defaultSeoTitle?: string
  defaultSeoDescription?: string | null
  defaultSocialAssetId?: string | null
  theme?: string
  // Theme customizer (Layer 2) — optional until the Appearance UI ships them.
  // null/undefined accent|font = use resolver default; mode resolves to 'system'.
  themeAccent?: string | null
  themeFont?: string | null
  themeMode?: string
}

export async function getSiteSettings(app: AppUserContext) {
  const db = createDataAccess(env.DB)
  const site = await db.sites.getSiteSettings(app.siteId)
  return {
    name: site?.name ?? 'My Blog',
    description: site?.description ?? '',
    defaultSeoTitle: site?.defaultSeoTitle ?? '',
    defaultSeoDescription: site?.defaultSeoDescription ?? '',
    defaultSocialAssetId: site?.defaultSocialAssetId ?? null,
    theme: resolvePresetId(site?.theme),
    slug: site?.slug ?? '',
    themeAccent: resolveAccent(site?.themeAccent),
    themeFont: resolveFont(site?.themeFont),
    themeMode: resolveMode(site?.themeMode),
    newsletterSettings: parseNewsletterSettings(site?.newsletterSettings),
    updatedAt: site?.updatedAt ?? 0,
  }
}

export async function completeSiteSetupForApp(
  app: AppUserContext,
  payload: CompleteSiteSetupPayload,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  if (!canManageSiteSettings(app)) return { kind: 'error', code: 'owner_required' }
  const timestamp = now()
  const name = payload.name.trim().slice(0, 80) || 'My Blog'
  const slug = slugify(payload.slug || name).slice(0, 42)
  if (isReservedSiteSlug(slug)) return { kind: 'error', code: 'slug_reserved' }
  const description =
    payload.description?.trim() ? payload.description.trim().slice(0, 220) : null

  const db = createDataAccess(env.DB)
  await db.sites.completeSiteSetup({
    timestamp,
    siteId: app.siteId,
    site: {
      name,
      slug,
      description,
      defaultSeoTitle: name,
      defaultSeoDescription: description,
    },
    defaultDomainHostname: defaultHostname(slug),
    activity: {
      id: `activity_site_setup_${app.user.id}_${timestamp}`,
      actorType: app.actor.type,
      actorId: app.actor.id,
      actorName: app.actor.name,
      action: 'site.updated',
      summary: `Configured ${name}`,
    },
  })

  return { kind: 'ok', code: 'setup_complete' }
}

export async function updateSiteSettingsForApp(
  app: AppUserContext,
  payload: SiteSettingsPayload,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  if (!canManageSiteSettings(app)) return { kind: 'error', code: 'owner_required' }
  if (!Number.isInteger(payload.expectedUpdatedAt) || payload.expectedUpdatedAt < 1) {
    return { kind: 'error', code: 'invalid_settings_version' }
  }

  const db = createDataAccess(env.DB)
  const currentSite = await db.sites.getSiteSettings(app.siteId)
  if (!currentSite) return { kind: 'error', code: 'site_not_found' }

  const site: Parameters<typeof db.sites.updateSiteSettings>[0]['site'] = {}
  if (payload.name !== undefined) {
    site.name = payload.name.trim().slice(0, 80) || 'My Blog'
  }
  if (payload.description !== undefined) {
    site.description = payload.description?.trim().slice(0, 220) || null
  }
  if (payload.defaultSeoTitle !== undefined) {
    site.defaultSeoTitle = payload.defaultSeoTitle.trim().slice(0, 120) || site.name || currentSite.name
  }
  if (payload.defaultSeoDescription !== undefined) {
    site.defaultSeoDescription = payload.defaultSeoDescription?.trim().slice(0, 220) || null
  }
  if (payload.defaultSocialAssetId !== undefined) {
    site.defaultSocialAssetId = payload.defaultSocialAssetId?.trim() || null
  }
  if (payload.theme !== undefined) site.theme = resolvePresetId(payload.theme)
  if (payload.themeAccent !== undefined) {
    site.themeAccent = payload.themeAccent === null ? null : resolveAccent(payload.themeAccent)
  }
  if (payload.themeFont !== undefined) {
    site.themeFont = payload.themeFont === null ? null : resolveFont(payload.themeFont)
  }
  if (payload.themeMode !== undefined) site.themeMode = resolveMode(payload.themeMode)

  if (Object.keys(site).length === 0) return { kind: 'error', code: 'no_settings_changes' }

  if (site.defaultSocialAssetId) {
    const asset = await db.assets.getAsset(app.siteId, site.defaultSocialAssetId)
    if (!asset) return { kind: 'error', code: 'invalid_social_image' }
    if (!asset.altText) return { kind: 'error', code: 'social_image_alt_required' }
  }

  const timestamp = Math.max(now(), currentSite.updatedAt + 1)
  const updated = await db.sites.updateSiteSettings({
    timestamp,
    siteId: app.siteId,
    expectedUpdatedAt: payload.expectedUpdatedAt,
    site,
    activity: {
      id: crypto.randomUUID(),
      actorType: app.actor.type,
      actorId: app.actor.id,
      actorName: app.actor.name,
      action: 'site.updated',
      summary: 'Updated site settings',
    },
  })
  if (!updated) return { kind: 'error', code: 'settings_conflict' }

  // Theme/customizer saves re-render every public page; the purge must reach
  // article HTML too (articles only self-purge on publish/archive). Enumerate
  // with the sitemap cap so large sites purge fully, and include custom
  // hostnames — their cache entries key by their own host.
  const published = await db.publicBlog.listPublishedPostSummaries(
    app.siteId,
    timestamp,
    PUBLIC_BLOG_LIMITS.sitemapSummaries,
  )
  const domainRows = await listCustomDomains(createD1DomainRepository(env.DB), app.siteId)
  const customHosts = domainRows.map((domain) => domain.hostname).filter(Boolean)
  scheduleSitePurge(app.siteId, currentSite.slug, published.map((row) => row.slug), customHosts)

  return { kind: 'ok', code: 'site_saved' }
}
