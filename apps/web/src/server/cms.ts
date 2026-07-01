import { listPosts, type Post } from '@vc/core'
import { createD1PostRepository, createDataAccess } from '@vc/db'
import { env } from 'cloudflare:workers'
import type { AppUserContext } from './onboarding'

type ActivityRow = { action: string; summary: string; actor_type: string; actor_name: string; created_at: number }

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

export async function getActivity(app: AppUserContext, limit = 50, offset = 0): Promise<ActivityRow[]> {
  const db = createDataAccess(env.DB)
  const rows = await db.activity.listBySitePaged(app.siteId, Math.min(Math.max(limit, 1), 101), Math.max(offset, 0))
  // listBySitePaged returns camelCase rows; map back to the snake_case shape the dashboard expects.
  return rows.map((r) => ({
    action: r.action,
    summary: r.summary,
    actor_type: r.actorType,
    actor_name: r.actorName,
    created_at: r.createdAt,
  }))
}