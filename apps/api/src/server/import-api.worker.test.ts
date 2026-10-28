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

const workspaceId = 'import-api-workspace'
const siteId = 'import-api-site'
const token = `vc_test_import_api_${'a'.repeat(32)}`

async function request(path: string, init: RequestInit = {}) {
  // The worker test configuration limits each workspace to one API call.
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(workspaceId).run()
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  return app.fetch(new Request(`https://app.basedui.dev${path}`, { ...init, headers }), env)
}

function post(path: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function json(response: Response) {
  return await response.json() as Record<string, any>
}

async function redirectRows() {
  return (await env.DB.prepare(
    'SELECT * FROM site_redirects WHERE site_id = ? ORDER BY from_path',
  ).bind(siteId).all()).results
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const now = Math.floor(Date.now() / 1000)
  const tokenHash = await hashApiToken(token, env.TOKEN_PEPPER)
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(workspaceId, 'Import API Workspace', workspaceId, now, now),
    env.DB.prepare(
      'INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(siteId, workspaceId, 'Import API Site', siteId, now, now),
    env.DB.prepare(
      `INSERT INTO api_keys (
        id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      'import-api-key', siteId, 'Import API key', token.slice(0, 18), tokenHash,
      JSON.stringify(['posts:read', 'posts:create', 'posts:publish', 'sites:read', 'site:write']),
      'Import API key', 'import-api-owner', now, now,
    ),
  ])
})

describe('import API behavior', () => {
  it('rejects an original date on a post that was already published without changing it', async () => {
    const createdResponse = await post('/api/v1/posts', {
      title: 'Imported post', slug: 'imported-post', contentMarkdown: 'An imported post.',
    })
    expect(createdResponse.status).toBe(201)
    const created = await json(createdResponse)
    const firstDate = 1_556_966_400
    const publishedResponse = await post(`/api/v1/posts/${created.id}/publish`, {
      expectedVersionNumber: created.currentVersionNumber,
      originalPublishedAt: firstDate,
    })
    expect(publishedResponse.status).toBe(200)
    const published = await json(publishedResponse)
    expect(published).toMatchObject({ status: 'published', originalPublishedAt: firstDate })

    const postBefore = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(created.id).first()
    const versionsBefore = (await env.DB.prepare(
      'SELECT * FROM post_versions WHERE post_id = ? ORDER BY version_number',
    ).bind(created.id).all()).results

    const rejected = await post(`/api/v1/posts/${created.id}/publish`, {
      expectedVersionNumber: published.currentVersionNumber,
      originalPublishedAt: '2018-05-04T09:00:00Z',
    })
    expect(rejected.status).toBe(400)
    expect((await json(rejected)).error.code).toBe('VALIDATION_ERROR')
    expect(await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(created.id).first()).toEqual(postBefore)
    expect((await env.DB.prepare(
      'SELECT * FROM post_versions WHERE post_id = ? ORDER BY version_number',
    ).bind(created.id).all()).results).toEqual(versionsBefore)
    const readBack = await request(`/api/v1/posts/${created.id}`)
    expect(readBack.status).toBe(200)
    expect(await json(readBack)).toMatchObject({
      status: 'published', originalPublishedAt: firstDate, publishedAt: published.publishedAt,
    })
  })

  it('rejects system paths atomically and enforces the free redirect limit', async () => {
    const initial = await post('/api/v1/site/redirects', {
      redirects: [{ from: '/old-existing', to: '/existing-post' }],
    })
    expect(initial.status).toBe(200)
    const beforeInvalid = await redirectRows()

    for (const from of ['/api/private', '/%61pi/private', '/docs/article', '/tag/news', '/og.png']) {
      const rejected = await post('/api/v1/site/redirects', {
        redirects: [
          { from: '/otherwise-valid', to: '/new-post' },
          { from, to: '/new-post' },
        ],
      })
      expect(rejected.status).toBe(400)
      expect((await json(rejected)).error.code).toBe('VALIDATION_ERROR')
      expect(await redirectRows()).toEqual(beforeInvalid)
    }

    const eighteen = Array.from({ length: 18 }, (_, index) => ({
      from: `/old-${index}`, to: `/post-${index}`,
    }))
    const added = await post('/api/v1/site/redirects', { redirects: eighteen })
    expect(added.status).toBe(200)
    const beforeOverLimit = await redirectRows()
    expect(beforeOverLimit).toHaveLength(19)

    const overLimit = await post('/api/v1/site/redirects', {
      redirects: [
        { from: '/last-available', to: '/post-last' },
        { from: '/over-limit', to: '/post-extra' },
      ],
    })
    expect(overLimit.status).toBe(402)
    expect((await json(overLimit)).error.code).toBe('BILLING_REQUIRED')
    expect(await redirectRows()).toEqual(beforeOverLimit)

    const last = await post('/api/v1/site/redirects', {
      redirects: [{ from: '/last-available', to: '/post-last' }],
    })
    expect(last.status).toBe(200)
    const atLimit = await redirectRows()
    expect(atLimit).toHaveLength(20)

    const mixed = await post('/api/v1/site/redirects', {
      redirects: [
        { from: '/old-existing', to: '/updated-post' },
        { from: '/over-limit', to: '/post-extra' },
      ],
    })
    expect(mixed.status).toBe(402)
    expect((await json(mixed)).error.code).toBe('BILLING_REQUIRED')
    expect(await redirectRows()).toEqual(atLimit)

    const update = await post('/api/v1/site/redirects', {
      redirects: [{ from: '/old-existing', to: '/updated-post' }],
    })
    expect(update.status).toBe(200)
    const updated = await redirectRows()
    expect(updated).toHaveLength(20)
    expect(updated).toEqual(expect.arrayContaining([
      expect.objectContaining({ from_path: '/old-existing', to_path: '/updated-post' }),
    ]))
  })
})
