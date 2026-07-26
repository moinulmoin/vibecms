import type { Actor } from '@vc/core'
import { env } from 'cloudflare:workers'

export type ApiKeyInsertBatch = {
  id: string
  siteId: string
  name: string
  tokenPrefix: string
  tokenHash: string
  scopesJson: string
  actorName: string
  createdByUserId: string
  timestamp: number
}

export async function insertApiKeyWithActivity(
  input: ApiKeyInsertBatch,
  actor: Actor,
  activityId: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.id,
      input.siteId,
      input.name,
      input.tokenPrefix,
      input.tokenHash,
      input.scopesJson,
      input.actorName,
      input.createdByUserId,
      input.timestamp,
      input.timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'api_key.created', 'api_key', ?, ?, NULL, NULL, ?)`,
    ).bind(activityId, input.siteId, actor.type, actor.id, actor.name, input.id, `Created API key ${input.name}`, input.timestamp),
  ])
}

export async function revokeApiKeyWithActivity(
  siteId: string,
  keyId: string,
  timestamp: number,
  actor: Actor,
  activityId: string,
): Promise<number> {
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE api_keys SET revoked_at = ?, updated_at = ? WHERE id = ? AND site_id = ? AND revoked_at IS NULL`,
    ).bind(timestamp, timestamp, keyId, siteId),
    env.DB.prepare(
      `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, created_at)
       SELECT ?, ?, ?, ?, ?, 'api_key.revoked', 'api_key', ?, 'Revoked API key', NULL, NULL, ?
       WHERE EXISTS (SELECT 1 FROM api_keys WHERE id = ? AND site_id = ? AND revoked_at = ?)`,
    ).bind(activityId, siteId, actor.type, actor.id, actor.name, keyId, timestamp, keyId, siteId, timestamp),
  ])
  return results[0]?.meta.changes ?? 0
}