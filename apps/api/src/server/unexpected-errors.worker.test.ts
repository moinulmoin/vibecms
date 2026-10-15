/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest'
import { AGENT_TOKEN_PRESETS } from '@vc/core'
import { app } from '@/index'
import { hashApiToken } from './api-keys'
import type * as Operations from './operations'

declare module 'vitest' { interface ProvidedContext { migrations: D1Migration[] } }

const { infrastructureFailure } = vi.hoisted(() => ({
  infrastructureFailure: () => new Error('D1 exploded token=raw-db-token', {
    cause: new Error('upstream failed with Bearer vc_live_leaked'),
  }),
}))

vi.mock('./mcp-dispatch', () => ({
  dispatchOperation: async () => { throw infrastructureFailure() },
}))
vi.mock('./operations', async (importOriginal) => ({
  ...(await importOriginal<typeof Operations>()),
  getSiteOp: async () => { throw infrastructureFailure() },
}))

const workspaceId = 'unexpected-errors-ws'
const siteId = 'unexpected-errors-site'
const token = `vc_test_unexpected_errors_${'u'.repeat(32)}`
const requestId = 'diag-request-0001'

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
  const t = Math.floor(Date.now() / 1000)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, 'Diag', workspaceId, t, t),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(siteId, workspaceId, 'Diag', siteId, t, t),
    env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').bind('unexpected-errors-owner', 'Owner', 'owner@unexpected-errors.test', t, t),
  ])
  await env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name,
    created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('unexpected-errors-key', siteId, 'Diag', token.slice(0, 18), await hashApiToken(token, env.TOKEN_PEPPER),
      JSON.stringify(AGENT_TOKEN_PRESETS.manage), 'Diag Agent', 'unexpected-errors-owner', t, t).run()
})

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(workspaceId).run()
})
afterEach(() => vi.restoreAllMocks())

function exceptionLines(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.includes('"unhandled_exception"'))
}

function expectSingleSanitizedLog(spy: { mock: { calls: unknown[][] } }, surface: string) {
  const lines = exceptionLines(spy)
  expect(lines).toHaveLength(1)
  const line = lines[0]!
  expect(line).not.toContain('raw-db-token')
  expect(line).not.toContain('vc_live_leaked')
  expect(line).not.toContain(token)
  expect(JSON.parse(line)).toMatchObject({
    surface,
    requestId,
    error: {
      message: 'D1 exploded token=[redacted]',
      stack: expect.stringContaining('D1 exploded'),
      cause: { message: 'upstream failed with Bearer [redacted]' },
    },
  })
}

describe('unexpected REST/MCP exceptions', () => {
  it('REST keeps the generic 500 envelope and logs one sanitized line with the response request id', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await app.fetch(new Request('https://app.vibecms.dev/api/v1/site', {
      headers: { authorization: `Bearer ${token}`, 'x-request-id': requestId },
    }), env)
    expect(response.status).toBe(500)
    expect(response.headers.get('X-Request-ID')).toBe(requestId)
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Request failed' } })
    expectSingleSanitizedLog(errorLog, 'rest')
  })

  it('MCP keeps the generic Tool failed error and logs one sanitized line with the response request id', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await app.fetch(new Request('https://app.vibecms.dev/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'sites.get', arguments: {} } }),
    }), env)
    expect(response.status).toBe(500)
    expect(response.headers.get('X-Request-ID')).toBe(requestId)
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 9, error: { code: -32000, message: 'Tool failed' } })
    expectSingleSanitizedLog(errorLog, 'mcp')
    expect(JSON.parse(exceptionLines(errorLog)[0]!)).toMatchObject({ tool: 'sites.get' })
  })
})
