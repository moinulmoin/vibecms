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
      'A clean blog for humans and agents.',
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