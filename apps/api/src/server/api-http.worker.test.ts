/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { app } from '@/index'
import { hashApiToken } from '@/server/api-keys'

declare module 'vitest' {
  interface ProvidedContext {
    migrations: D1Migration[]
  }
}

const HTTP_WORKSPACE_ID = 'api-http-autoseopilot-workspace'
const HTTP_SITE_A_ID = 'api-http-autoseopilot-site-a'
const HTTP_SITE_B_ID = 'api-http-autoseopilot-site-b'
const HTTP_READ_TOKEN = `vc_test_http_read_${'a'.repeat(32)}`
const HTTP_NO_POSTS_READ_TOKEN = `vc_test_http_scope_${'b'.repeat(32)}`

async function json(response: Response) {
  return (await response.json()) as Record<string, any>
}

async function request(path: string, token: string) {
  return app.fetch(
    new Request(`https://app.basedui.dev${path}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
  )
}

async function resetUsage() {
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?')
    .bind(HTTP_WORKSPACE_ID)
    .run()
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const timestamp = Math.floor(Date.now() / 1000)
  const readHash = await hashApiToken(HTTP_READ_TOKEN, env.TOKEN_PEPPER)
  const scopeHash = await hashApiToken(HTTP_NO_POSTS_READ_TOKEN, env.TOKEN_PEPPER)

  await env.DB.batch([
    env.DB
      .prepare(
        'INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(HTTP_WORKSPACE_ID, 'HTTP API Workspace', HTTP_WORKSPACE_ID, timestamp, timestamp),
    env.DB
      .prepare(
        'INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(HTTP_SITE_A_ID, HTTP_WORKSPACE_ID, 'HTTP Site A', 'api-http-site-a', timestamp, timestamp),
    env.DB
      .prepare(
        'INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(HTTP_SITE_B_ID, HTTP_WORKSPACE_ID, 'HTTP Site B', 'api-http-site-b', timestamp, timestamp),
    env.DB
      .prepare(
        `INSERT INTO api_keys (
           id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
           created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'api-http-autoseopilot-key-read',
        HTTP_SITE_A_ID,
        'HTTP read key',
        HTTP_READ_TOKEN.slice(0, 18),
        readHash,
        JSON.stringify(['sites:read', 'posts:read']),
        'HTTP read key',
        'api-http-owner',
        timestamp,
        timestamp,
      ),
    env.DB
      .prepare(
        `INSERT INTO api_keys (
           id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
           created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'api-http-autoseopilot-key-scope',
        HTTP_SITE_A_ID,
        'HTTP scope key',
        HTTP_NO_POSTS_READ_TOKEN.slice(0, 18),
        scopeHash,
        JSON.stringify(['sites:read']),
        'HTTP scope key',
        'api-http-owner',
        timestamp,
        timestamp,
      ),
    env.DB
      .prepare(
        `INSERT INTO posts (
           id, site_id, title, slug, content_markdown, status,
           created_by_type, created_by_id, updated_by_type, updated_by_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'draft', 'api_key', ?, 'api_key', ?, ?, ?)`,
      )
      .bind(
        'api-http-autoseopilot-post-a',
        HTTP_SITE_A_ID,
        'HTTP Site A post',
        'api-http-site-a-only',
        '# Site A',
        'api-http-autoseopilot-key-read',
        'api-http-autoseopilot-key-read',
        timestamp,
        timestamp,
      ),
    env.DB
      .prepare(
        `INSERT INTO posts (
           id, site_id, title, slug, content_markdown, status,
           created_by_type, created_by_id, updated_by_type, updated_by_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'draft', 'api_key', ?, 'api_key', ?, ?, ?)`,
      )
      .bind(
        'api-http-autoseopilot-post-b',
        HTTP_SITE_B_ID,
        'HTTP Site B post',
        'api-http-site-b-only',
        '# Site B',
        'api-http-autoseopilot-key-read',
        'api-http-autoseopilot-key-read',
        timestamp,
        timestamp,
      ),
  ])
})

describe('REST by-slug HTTP isolation', () => {
  it('returns the exact post, 404s missing and foreign slugs, and enforces posts:read', async () => {
    const found = await request('/api/v1/posts/by-slug/api-http-site-a-only', HTTP_READ_TOKEN)
    expect(found.status).toBe(200)
    expect(await json(found)).toMatchObject({
      id: 'api-http-autoseopilot-post-a',
      slug: 'api-http-site-a-only',
      contentMarkdown: '# Site A',
    })

    await resetUsage()
    const missing = await request('/api/v1/posts/by-slug/api-http-missing', HTTP_READ_TOKEN)
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('NOT_FOUND')

    await resetUsage()
    const foreign = await request('/api/v1/posts/by-slug/api-http-site-b-only', HTTP_READ_TOKEN)
    expect(foreign.status).toBe(404)
    expect((await json(foreign)).error.code).toBe('NOT_FOUND')

    await resetUsage()
    const missingScope = await request(
      '/api/v1/posts/by-slug/api-http-site-a-only',
      HTTP_NO_POSTS_READ_TOKEN,
    )
    expect(missingScope.status).toBe(403)
    expect((await json(missingScope)).error.code).toBe('FORBIDDEN')
  })
})
