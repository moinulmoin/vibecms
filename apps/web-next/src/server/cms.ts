import { listPosts, type Post } from '@vc/core'
import { createD1PostRepository } from '@vc/db'
import { env } from 'cloudflare:workers'
import type { AppUserContext } from './onboarding'

type ActivityRow = { action: string; summary: string; actor_name: string; created_at: number }

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

export async function getActivity(app: AppUserContext, limit = 50) {
  const activity = await env.DB.prepare(
    `SELECT action, summary, actor_name, created_at
     FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(app.siteId, Math.min(Math.max(limit, 1), 100))
    .all<ActivityRow>()
  return activity.results ?? []
}