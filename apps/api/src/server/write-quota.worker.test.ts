/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { AGENT_TOKEN_PRESETS, createPost, type Actor } from '@vc/core'
import { createD1PostRepository } from '@vc/db'
import type { McpToolName } from '@vc/api-contract'
import { app } from '@/index'
import { hashApiToken } from './api-keys'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

// API_USAGE_TEST_LIMIT=1 (vitest.config.ts): every counter's limit is 1.
const workspaceId = 'write-quota-ws'
const siteId = 'write-quota-site'
const keyId = 'write-quota-key'
const token = `vc_test_write_quota_${'q'.repeat(32)}`
const actor: Actor = { type: 'api_key', id: keyId, name: 'Quota Agent', scopes: AGENT_TOKEN_PRESETS.manage }
let postId = ''

/** Fresh call counters, workspace writes for today already at the limit. */
async function exhaustWrites() {
  const t = Math.floor(Date.now() / 1000)
  const today = new Date().toISOString().slice(0, 10)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(workspaceId),
    env.DB.prepare('INSERT INTO usage_counters (id, workspace_id, site_id, period, metric, value, created_at, updated_at) VALUES (?, ?, null, ?, ?, 1, ?, ?)')
      .bind(`workspace:${workspaceId}:writes:${today}`, workspaceId, today, 'writes', t, t),
  ])
}

function rest(method: string, path: string, body?: unknown) {
  return app.fetch(new Request(`https://app.vibecms.dev/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env)
}

async function mcp(name: McpToolName, args: Record<string, unknown>) {
  const response = await app.fetch(new Request('https://app.vibecms.dev/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), env)
  expect(response.status).toBe(200)
  return response.json()
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const t = Math.floor(Date.now() / 1000)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, 'Quota', workspaceId, t, t),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(siteId, workspaceId, 'Quota', siteId, t, t),
    env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').bind('write-quota-owner', 'Owner', 'owner@write-quota.test', t, t),
  ])
  await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
    created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(keyId, siteId, 'Quota', token.slice(0, 18), await hashApiToken(token, env.TOKEN_PEPPER),
      JSON.stringify(AGENT_TOKEN_PRESETS.manage), 'Quota Agent', 'write-quota-owner', t, t).run()
  const post = await createPost(createD1PostRepository(env.DB), actor, {
    siteId, title: 'Quota target', slug: 'write-quota-target', contentMarkdown: 'Body',
  })
  postId = post.id
})

beforeEach(exhaustWrites)

describe('exhausted workspace write budget', () => {
  const restCases: Array<[string, string, string, () => unknown]> = [
    ['posts.schedule', 'POST', '/posts/{postId}/schedule', () => ({ versionNumber: 1, publishAt: Math.floor(Date.now() / 1000) + 86_400 })],
    ['posts.unschedule', 'POST', '/posts/{postId}/unschedule', () => undefined],
    ['posts.preview.rotate', 'POST', '/posts/{postId}/preview/rotate', () => undefined],
    ['posts.unarchive', 'POST', '/posts/{postId}/unarchive', () => undefined],
    ['assets.update', 'PATCH', '/assets/write-quota-missing-asset', () => ({ altText: 'Alt' })],
  ]

  for (const [tool, method, path, body] of restCases) {
    it(`REST ${method} ${path} is rejected on the writes metric`, async () => {
      const before = await rest('GET', `/posts/${postId}`)
      expect(before.status).toBe(200)
      const postBefore = await before.json()
      await exhaustWrites()

      const response = await rest(method, path.replace('{postId}', postId), body())
      expect(response.status, tool).toBe(429)
      expect(response.headers.get('X-RateLimit-Metric')).toBe('writes')
      expect(await response.json()).toMatchObject({ error: { code: 'RATE_LIMIT' } })

      await exhaustWrites()
      expect(await (await rest('GET', `/posts/${postId}`)).json()).toEqual(postBefore)
    })
  }

  it('MCP mutations return RATE_LIMIT on the writes metric without mutating', async () => {
    const before = await mcp('posts.get', { postId })
    expect(before).toMatchObject({ result: { structuredContent: { id: postId } } })
    expect(before).not.toHaveProperty('result.isError')
    const calls: Array<[McpToolName, Record<string, unknown>]> = [
      ['posts.schedule', { postId, versionNumber: 1, publishAt: Math.floor(Date.now() / 1000) + 86_400 }],
      ['posts.unschedule', { postId }],
      ['posts.preview.rotate', { postId }],
      ['posts.unarchive', { postId }],
      ['assets.update', { assetId: 'write-quota-missing-asset', altText: 'Alt' }],
    ]
    for (const [name, args] of calls) {
      await exhaustWrites()
      expect(await mcp(name, args), name).toMatchObject({
        result: { isError: true, structuredContent: { code: 'RATE_LIMIT', message: expect.stringContaining('writes') } },
      })
    }
    await exhaustWrites()
    expect(await mcp('posts.get', { postId })).toEqual(before)
  })

  it('still serves reads, and the same mutation passes the budget once writes reset', async () => {
    expect((await rest('GET', `/posts/${postId}`)).status).toBe(200)
    await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(workspaceId).run()
    const rotated = await rest('POST', `/posts/${postId}/preview/rotate`)
    expect(rotated.status).toBe(200)
  })
})
