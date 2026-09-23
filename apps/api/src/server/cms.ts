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
    changes: describeActivityChanges(r.before, r.after),
  }))
}
