import type { Actor } from '@vc/core'
import { listCustomDomains } from '@vc/core'
import { resolveAccent, resolveFont, resolveMode, resolvePresetId } from '@vc/config'
import { createDataAccess, createD1DomainRepository, PUBLIC_BLOG_LIMITS } from '@vc/db'
import { isReservedSiteSlug } from '@vc/validators'
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

// Agent identity codes the "Make it yours" step collects; anything outside
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
  await createDataAccess(env.DB).sites.updateSitePersonalization({
    timestamp,
    siteId: app.siteId,
    agentPreference: sanitizeAgentPreference(payload.agentPreference),
    voiceSeed: sanitizeVoiceSeed(payload.voiceSeed),
    onboardingNote: payload.onboardingNote?.trim() ? payload.onboardingNote.trim().slice(0, 500) : null,
    activity: {
      id: `activity_site_personalization_${app.user.id}_${timestamp}_${crypto.randomUUID()}`,
      actorType: app.actor.type,
      actorId: app.actor.id,
      actorName: app.actor.name,
      action: 'site.updated',
      summary: 'Personalized the onboarding guidance',
    },
  })
  return { kind: 'ok', code: 'personalization_saved' }
}

export type SiteSettingsPayload = {
  name: string
  description?: string
  defaultSeoTitle: string
  defaultSeoDescription?: string
  defaultSocialAssetId?: string | null
  theme: string
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
  const timestamp = now()
  const name = payload.name.trim().slice(0, 80) || 'My Blog'
  const description = payload.description?.trim() ? payload.description.trim().slice(0, 220) : null
  const defaultSeoTitle = payload.defaultSeoTitle.trim().slice(0, 120) || name
  const defaultSeoDescription = payload.defaultSeoDescription?.trim()
    ? payload.defaultSeoDescription.trim().slice(0, 220)
    : null
  const theme = resolvePresetId(payload.theme)
  // Theme customizer: null accent|font persists null (resolver defaults on read);
  // an explicit value is resolved to a known id. Mode always resolves to a valid value.
  const themeAccent = payload.themeAccent == null ? null : resolveAccent(payload.themeAccent)
  const themeFont = payload.themeFont == null ? null : resolveFont(payload.themeFont)
  const themeMode = resolveMode(payload.themeMode)

  const db = createDataAccess(env.DB)
  const currentSite = await db.sites.getSiteSettings(app.siteId)
  const defaultSocialAssetId =
    payload.defaultSocialAssetId === undefined
      ? currentSite?.defaultSocialAssetId ?? null
      : payload.defaultSocialAssetId?.trim() || null
  if (defaultSocialAssetId) {
    const asset = await db.assets.getAsset(app.siteId, defaultSocialAssetId)
    if (!asset) return { kind: 'error', code: 'invalid_social_image' }
    if (!asset.altText) return { kind: 'error', code: 'social_image_alt_required' }
  }

  await db.sites.updateSiteSettings({
    timestamp,
    siteId: app.siteId,
    site: {
      name,
      description,
      defaultSeoTitle,
      defaultSeoDescription,
      defaultSocialAssetId,
      theme,
      themeAccent,
      themeFont,
      themeMode,
    },
    activity: {
      id: crypto.randomUUID(),
      actorType: app.actor.type,
      actorId: app.actor.id,
      actorName: app.actor.name,
      action: 'site.updated',
      summary: 'Updated site settings',
    },
  })
  if (currentSite) {
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
  }

  return { kind: 'ok', code: 'site_saved' }
}
