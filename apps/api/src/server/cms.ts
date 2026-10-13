import { ACCENTS, FONTS, THEME_PRESETS, CHROME_LABELS, INDEX_LABELS, HEADER_LABELS } from '@vc/config'
import { listPosts, type Post } from '@vc/core'
import { createD1PostRepository, createDataAccess } from '@vc/db'
import { env } from 'cloudflare:workers'
import type { AppUserContext } from './onboarding'

type ActivityRow = {
  id: string
  action: string
  summary: string
  actor_type: string
  actor_name: string
  created_at: number
  entity_type: string
  entity_id: string
  changes: string[]
}

export type ActivityActorFilter = 'human' | 'agent'

type Snapshot = {
  title: string | null
  slug: string | null
  status: string | null
  altText: string | null
  name: string | null
  bodyLength: number | null
}

function quote(value: string | null) {
  return value ? `“${value.length > 60 ? `${value.slice(0, 57)}…` : value}”` : 'empty'
}

/** Short, human before → after lines for the activity feed. */
export function describeActivityChanges(before: Snapshot | null, after: Snapshot | null): string[] {
  if (!before || !after) return []
  const changes: string[] = []
  if (before.title !== after.title && after.title !== null) changes.push(`Title ${quote(before.title)} → ${quote(after.title)}`)
  if (before.slug !== after.slug && after.slug !== null) changes.push(`URL /${before.slug ?? ''} → /${after.slug}`)
  if (before.status !== after.status && before.status && after.status) changes.push(`Status ${before.status} → ${after.status}`)
  if (before.name !== after.name && after.name !== null) changes.push(`Name ${quote(before.name)} → ${quote(after.name)}`)
  if (before.altText !== after.altText) changes.push(`Alt text ${quote(before.altText)} → ${quote(after.altText)}`)
  if (before.bodyLength !== null && after.bodyLength !== null && before.bodyLength !== after.bodyLength) {
    const delta = after.bodyLength - before.bodyLength
    changes.push(`Body ${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('en')} characters`)
  }
  return changes
}

// Human labels for site settings recorded in site.* activity snapshots.
const SITE_FIELD_LABELS: Record<string, string> = {
  name: 'Name', description: 'Description', bylineName: 'Byline', showAgentCredit: 'Credit your agent',
  defaultSeoTitle: 'Search title', defaultSeoDescription: 'Search description',
  theme: 'Template', template: 'Template', themeAccent: 'Accent', accent: 'Accent',
  themeFont: 'Font', font: 'Font', themeRadius: 'Corners', radius: 'Corners',
  themeWidth: 'Reading width', width: 'Reading width',
  themeChrome: 'Navigation', chrome: 'Navigation', themeIndex: 'Home page', index: 'Home page',
  themeHeader: 'Article header', header: 'Article header', themeMode: 'Color mode', mode: 'Color mode',
  enabled: 'Signup form', heading: 'Signup heading', subtext: 'Signup description', buttonLabel: 'Signup button',
  audience: 'Audience', voiceSummary: 'Voice summary',
}

function parseSnapshot(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// Show the names the owner sees in the dashboard, not internal ids.
const DISPLAY_NAMES: Record<string, Record<string, string>> = {
  Template: Object.fromEntries(Object.values(THEME_PRESETS).map((p) => [p.id, p.name])),
  Font: Object.fromEntries(FONTS.map((f) => [f.id, f.name])),
  Accent: Object.fromEntries(ACCENTS.map((a) => [a.id, a.name])),
  Navigation: CHROME_LABELS,
  'Home page': INDEX_LABELS,
  'Article header': HEADER_LABELS,
}
const THEME_LABELS = new Set(['Accent', 'Font', 'Corners', 'Reading width', 'Navigation', 'Home page', 'Article header', 'Color mode'])

function siteValue(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return THEME_LABELS.has(label) ? 'template default' : 'empty'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string') return quote(DISPLAY_NAMES[label]?.[value] ?? value)
  if (typeof value === 'number') return String(value)
  return null
}

/** "Accent “rust” → “violet”" lines for site settings, theme, signup form, and voice events. */
export function describeSiteChanges(beforeRaw: string | null | undefined, afterRaw: string | null | undefined): string[] {
  const before = parseSnapshot(beforeRaw)
  const after = parseSnapshot(afterRaw)
  if (!before || !after) return []
  const changes: string[] = []
  for (const [key, label] of Object.entries(SITE_FIELD_LABELS)) {
    if (!(key in after)) continue
    const from = siteValue(label, before[key])
    const to = siteValue(label, after[key])
    if (from !== null && to !== null && from !== to) changes.push(`${label} ${from} → ${to}`)
  }
  for (const key of ['navLinksJson', 'navLinks', 'socialLinksJson', 'socialLinks', 'guidelines']) {
    if (key in after && JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes.push(key.startsWith('nav') ? 'Navigation links changed' : key.startsWith('social') ? 'Social links changed' : 'Voice rules changed')
    }
  }
  return changes
}

function repository() {
  return createD1PostRepository(env.DB)
}

export async function getPosts(
  app: AppUserContext,
  status?: Post['status'],
  search?: string,
  limit = 100,
  offset = 0,
) {
  return listPosts(repository(), app.actor, { siteId: app.siteId, status, search, limit, offset })
}

export async function getActivity(
  app: AppUserContext,
  limit = 50,
  offset = 0,
  actor?: ActivityActorFilter,
): Promise<ActivityRow[]> {
  const db = createDataAccess(env.DB)
  const actorTypes = actor === 'human' ? (['human'] as const) : actor === 'agent' ? (['api_key', 'agent'] as const) : undefined
  const rows = await db.activity.listBySitePaged(
    app.siteId,
    Math.min(Math.max(limit, 1), 101),
    Math.max(offset, 0),
    actorTypes ? [...actorTypes] : undefined,
  )
  // listBySitePaged returns camelCase rows; map back to the snake_case shape the dashboard expects.
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    actor_type: r.actorType,
    actor_name: r.actorName,
    created_at: r.createdAt,
    entity_type: r.entityType,
    entity_id: r.entityId,
    changes: r.action.startsWith('site.')
      ? describeSiteChanges(r.siteBefore, r.siteAfter)
      : describeActivityChanges(r.before, r.after),
  }))
}
