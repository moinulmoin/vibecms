/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, expect, inject, it, vi } from 'vitest'
import { AGENT_TOKEN_PRESETS } from '@vc/core'
import { API_USAGE_LIMITS } from '@vc/config'
import { app } from '@/index'
import { hashApiToken } from './api-keys'

const workspaceId = 'per-key-usage-workspace'
const siteId = 'per-key-usage-site'
const keyIds = ['per-key-agent-a', 'per-key-agent-b']
const tokens = ['vc_test_per_key_a_' + 'a'.repeat(32), 'vc_test_per_key_b_' + 'b'.repeat(32)]
const savedEnv = { APP_ENV: env.APP_ENV, API_USAGE_TEST_LIMIT: env.API_USAGE_TEST_LIMIT }

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations'))
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').bind(workspaceId, 'Per key', workspaceId),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)').bind(siteId, workspaceId, 'Per key', siteId),
    env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)').bind('per-key-owner', 'Owner', 'owner@per-key.test'),
  ])
  for (const [index, keyId] of keyIds.entries()) {
    const token = tokens[index]!
    await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
      created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`)
      .bind(keyId, siteId, keyId, token.slice(0, 18), await hashApiToken(token, env.TOKEN_PEPPER),
        JSON.stringify(AGENT_TOKEN_PRESETS.manage), 'Per-key Agent', 'per-key-owner').run()
  }
})

afterEach(() => {
  env.APP_ENV = savedEnv.APP_ENV
  env.API_USAGE_TEST_LIMIT = savedEnv.API_USAGE_TEST_LIMIT
  vi.useRealTimers()
})

it('counts same-minute agent budgets separately and only throttles the exhausted key', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T14:12:15Z'))
  env.APP_ENV = 'production'
  env.API_USAGE_TEST_LIMIT = undefined
  const period = '2026-10-28T14:12Z'
  const limit = API_USAGE_LIMITS.free.token.minute
  await env.DB.prepare(`INSERT INTO usage_counters (id, workspace_id, site_id, period, metric, value, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'calls', ?, 1, 1)`)
    .bind(`token:${keyIds[0]}:calls:${period}`, workspaceId, siteId, period, limit - 1).run()
  const call = (index: number) => app.fetch(new Request('https://app.vibecms.dev/api/v1/posts', {
    headers: { authorization: `Bearer ${tokens[index]}` },
  }), env)

  expect((await call(0)).status).toBe(200)
  expect((await call(1)).status).toBe(200)
  const denied = await call(0)
  expect(denied.status).toBe(429)
  expect(denied.headers.get('X-RateLimit-Limit')).toBe(String(limit))
  expect(denied.headers.get('X-RateLimit-Remaining')).toBe('0')
  expect(await denied.json()).toMatchObject({ error: { code: 'RATE_LIMIT' } })
  expect((await call(1)).status).toBe(200)
  const counters = await env.DB.prepare('SELECT id, value FROM usage_counters WHERE site_id = ? ORDER BY id').bind(siteId).all()
  expect(counters.results).toEqual([
    { id: `token:${keyIds[0]}:calls:${period}`, value: limit },
    { id: `token:${keyIds[1]}:calls:${period}`, value: 2 },
  ])
  const workspace = await env.DB.prepare('SELECT value FROM usage_counters WHERE id = ?')
    .bind(`workspace:${workspaceId}:calls:${period}`).first<{ value: number }>()
  expect(workspace?.value).toBe(3)
})
