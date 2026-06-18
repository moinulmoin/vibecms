import type { Actor } from '@vc/core'
import { env } from 'cloudflare:workers'
import { ensureBillingRow } from '~/server/billing'

type AuthSessionUser = { id: string; name: string; email: string }

export type AppUserContext = {
  user: AuthSessionUser
  siteId: string
  workspaceId: string
  actor: Actor
}

type RoleRow = { role: 'owner' | 'editor' | 'viewer' }
type SiteSetupRow = { name: string; slug: string; description: string | null; default_seo_title: string | null }

function now() {
  return Math.floor(Date.now() / 1000)
}

function slugify(input: string) {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 42)
  return slug || 'site'
}

export function publicBlogBaseDomain() {
  const raw = env.PUBLIC_BLOG_DOMAIN?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const hostname = url.hostname.toLowerCase()
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1')
      return null
    return hostname
  } catch {
    return null
  }
}

export function defaultHostname(slug: string) {
  return `${slug}.${publicBlogBaseDomain() ?? 'localhost'}`
}

export function isLocalDefaultHostname(hostname: string) {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost')
}

export async function ensureOnboarding(user: AuthSessionUser): Promise<AppUserContext> {
  const timestamp = now()
  const workspaceId = `workspace_${user.id}`
  const siteId = `site_${user.id}`
  const baseSlug = slugify(user.name || user.email.split('@')[0] || user.id)
  const siteSlug = `${baseSlug}-${user.id.slice(0, 8).toLowerCase()}`

  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(workspaceId, `${user.name || 'My'} Workspace`, `workspace-${user.id}`, timestamp, timestamp),
    env.DB.prepare(
      "INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'owner', ?, ?)",
    ).bind(`membership_${user.id}`, workspaceId, user.id, timestamp, timestamp),
    env.DB.prepare(
      "INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
    ).bind(
      siteId,
      workspaceId,
      `${user.name || 'My'} Blog`,
      siteSlug,
      'A clean blog for you and your agents.',
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'default', 'active', ?, ?)",
    ).bind(`domain_${user.id}`, siteId, defaultHostname(siteSlug), timestamp, timestamp),
    env.DB.prepare(
      "INSERT OR IGNORE INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, 'system', 'system', 'System', 'site.created', 'site', ?, ?, ?)",
    ).bind(`activity_site_created_${user.id}`, siteId, siteId, 'Created site during onboarding', timestamp),
  ])
  await ensureBillingRow(workspaceId, 'none')

  const membership = await env.DB.prepare(
    'SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1',
  )
    .bind(workspaceId, user.id)
    .first<RoleRow>()
  const actor: Actor = {
    type: 'human',
    id: user.id,
    name: user.name || user.email,
    role: membership?.role ?? 'viewer',
  }

  return { user, siteId, workspaceId, actor }
}

export async function getSiteSetup(app: AppUserContext) {
  const site = await env.DB.prepare(
    'SELECT name, slug, description, default_seo_title FROM sites WHERE id = ? LIMIT 1',
  )
    .bind(app.siteId)
    .first<SiteSetupRow>()
  return {
    name: site?.name ?? 'My Blog',
    slug: site?.slug ?? 'my-blog',
    description: site?.description ?? '',
    isComplete: Boolean(site?.default_seo_title),
  }
}

export type CompleteSiteSetupPayload = {
  name: string
  slug: string
  description?: string
}

export type SiteSettingsPayload = {
  name: string
  description?: string
  defaultSeoTitle: string
  defaultSeoDescription?: string
}

export async function getSiteSettings(app: AppUserContext) {
  const site = await env.DB.prepare(
    'SELECT name, description, default_seo_title, default_seo_description FROM sites WHERE id = ? LIMIT 1',
  )
    .bind(app.siteId)
    .first<{
      name: string
      description: string | null
      default_seo_title: string | null
      default_seo_description: string | null
    }>()
  return {
    name: site?.name ?? 'My Blog',
    description: site?.description ?? '',
    defaultSeoTitle: site?.default_seo_title ?? '',
    defaultSeoDescription: site?.default_seo_description ?? '',
  }
}

export async function completeSiteSetupForApp(
  app: AppUserContext,
  payload: CompleteSiteSetupPayload,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  const timestamp = now()
  const name = payload.name.trim().slice(0, 80) || 'My Blog'
  const slug = slugify(payload.slug || name).slice(0, 42)
  const description =
    payload.description?.trim() ? payload.description.trim().slice(0, 220) : null

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE sites SET name = ?, slug = ?, description = ?, default_seo_title = ?, default_seo_description = ?, updated_at = ? WHERE id = ?',
    ).bind(name, slug, description, name, description, timestamp, app.siteId),
    env.DB.prepare('UPDATE domains SET hostname = ?, updated_at = ? WHERE site_id = ? AND type = ?')
      .bind(defaultHostname(slug), timestamp, app.siteId, 'default'),
    env.DB.prepare(
      'INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      `activity_site_setup_${app.user.id}_${timestamp}`,
      app.siteId,
      app.actor.type,
      app.actor.id,
      app.actor.name,
      'site.updated',
      'site',
      app.siteId,
      `Configured ${name}`,
      timestamp,
    ),
  ])

  return { kind: 'ok', code: 'setup_complete' }
}

export async function updateSiteSettingsForApp(
  app: AppUserContext,
  payload: SiteSettingsPayload,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  const timestamp = now()
  const name = payload.name.trim().slice(0, 80) || 'My Blog'
  const description = payload.description?.trim() ? payload.description.trim().slice(0, 220) : null
  const defaultSeoTitle = payload.defaultSeoTitle.trim().slice(0, 120) || name
  const defaultSeoDescription = payload.defaultSeoDescription?.trim()
    ? payload.defaultSeoDescription.trim().slice(0, 220)
    : null

  await env.DB.prepare(
    'UPDATE sites SET name = ?, description = ?, default_seo_title = ?, default_seo_description = ?, updated_at = ? WHERE id = ?',
  )
    .bind(name, description, defaultSeoTitle, defaultSeoDescription, timestamp, app.siteId)
    .run()

  await env.DB.prepare(
    'INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      crypto.randomUUID(),
      app.siteId,
      app.actor.type,
      app.actor.id,
      app.actor.name,
      'site.updated',
      'site',
      app.siteId,
      'Updated site settings',
      timestamp,
    )
    .run()

  return { kind: 'ok', code: 'site_saved' }
}