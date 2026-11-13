/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { SUPPORT_EMAIL } from '@vc/config'
import { clearSiteSuspensionSql, createDataAccess, suspendSiteSql } from '@vc/db'
import { app } from '@/index'
import { hashApiToken } from '@/server/api-keys'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const NOW = Math.floor(Date.now() / 1000)
const WORKSPACE_ID = 'suspension-ws'
const SITE_ID = 'suspension-site'
const TOKEN = `vc_test_suspension_${'a'.repeat(32)}`

async function call(path: string, body: unknown) {
  // The worker test configuration limits each workspace to one API call.
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(WORKSPACE_ID).run()
  const response = await app.fetch(new Request(`https://app.basedui.dev${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env)
  return { status: response.status, body: await response.json() as Record<string, any> }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(WORKSPACE_ID, 'Suspension', WORKSPACE_ID, NOW, NOW),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(SITE_ID, WORKSPACE_ID, 'Suspension blog', SITE_ID, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at)
       VALUES ('suspension-key', ?, 'Agent', ?, ?, ?, 'Agent', 'owner', ?, ?)`,
    ).bind(SITE_ID, TOKEN.slice(0, 18), await hashApiToken(TOKEN, env.TOKEN_PEPPER), JSON.stringify(['posts:read', 'posts:create', 'posts:publish']), NOW, NOW),
  ])
})

describe('operator suspension', () => {
  it('refuses publish on a suspended blog with the support address, and publishes again once cleared', async () => {
    const draft = await call('/api/v1/posts', { title: 'Draft', slug: 'draft', contentMarkdown: 'Kept.' })
    expect(draft.status).toBe(201)
    await env.DB.prepare(suspendSiteSql(SITE_ID, 'Spam', NOW)).run()

    const refused = await call(`/api/v1/posts/${draft.body.id}/publish`, { expectedVersionNumber: draft.body.currentVersionNumber })
    expect(refused.status).toBe(403)
    expect(refused.body.error.message).toMatch(/suspended/i)
    expect(refused.body.error.message).toContain(SUPPORT_EMAIL)
    const row = await env.DB.prepare('SELECT status FROM posts WHERE id = ?').bind(draft.body.id).first<{ status: string }>()
    expect(row?.status).toBe('draft')

    await env.DB.prepare(clearSiteSuspensionSql(SITE_ID)).run()
    const published = await call(`/api/v1/posts/${draft.body.id}/publish`, { expectedVersionNumber: draft.body.currentVersionNumber })
    expect(published.status).toBe(200)
    expect(published.body.status).toBe('published')
  })

  it('leaves a managed blog revoke and claim clock untouched through suspend and clear', async () => {
    const revokedAt = NOW - 3 * 86400
    await env.DB.batch([
      env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind('managed-ws', 'Managed', 'managed-ws', NOW, NOW),
      env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('managed-site', 'managed-ws', 'Managed blog', 'managed-site', NOW, NOW),
      env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
        .bind('managed-owner', 'Owner', 'managed-owner@example.test', NOW, NOW),
      env.DB.prepare(
        `INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at)
         VALUES ('managed-key', 'managed-site', 'AutoSEOPilot', 'prefix', 'hash-managed', '[]', 'AutoSEOPilot', 'managed-owner', ?, ?)`,
      ).bind(NOW, NOW),
      env.DB.prepare(
        `INSERT INTO autoseopilot_managed_sites (
           id, external_workspace_id, owner_user_id, workspace_id, site_id, credential_id, credential_generation,
           api_key_id, entitlement_status, entitlement_expires_at, lifecycle_revision, created_at, updated_at, revoked_at
         ) VALUES ('managed-binding', 'managed-external', 'managed-owner', 'managed-ws', 'managed-site', 'managed-credential', 1,
           'managed-key', 'revoked', NULL, 2, ?, ?, ?)`,
      ).bind(NOW - 10 * 86400, revokedAt, revokedAt),
    ])
    const binding = () => env.DB.prepare('SELECT * FROM autoseopilot_managed_sites WHERE site_id = ?').bind('managed-site').first()
    const clock = async () => (await createDataAccess(env.DB).managedSites.resolveSite('managed-site', { selfHosted: false, now: NOW }))?.claim
    const before = { binding: await binding(), clock: await clock() }
    expect(before.clock).toMatchObject({ state: 'grace', pausedAt: revokedAt + 7 * 86400, deadline: revokedAt + 30 * 86400 })

    await env.DB.prepare(suspendSiteSql('managed-site', 'Spam', NOW)).run()
    expect({ binding: await binding(), clock: await clock() }).toEqual(before)

    await env.DB.prepare(clearSiteSuspensionSql('managed-site')).run()
    expect({ binding: await binding(), clock: await clock() }).toEqual(before)
  })
})
