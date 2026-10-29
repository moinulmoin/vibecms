/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { AGENT_TOKEN_PRESETS } from '@vc/core'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { app } from '@/index'
import { hashApiToken } from '@/server/api-keys'

declare module 'vitest' {
  interface ProvidedContext { migrations: D1Migration[] }
}

const issuer = env.APP_URL.replace(/\/$/, '')
const resource = `${issuer}/mcp`
const callback = 'https://client.example/callback?source=agent'
const verifier = 'a'.repeat(64)
const scopes = [...AGENT_TOKEN_PRESETS.draft, 'offline_access'].join(' ')

type Json = Record<string, any>
type Fixture = {
  ownerCookie: string
  otherCookie: string
  site: string
  otherSite: string
  workspace: string
  key: string
}
type Client = { id: string; redirect: string }
type Authorization = { client: Client; id: string; code: string }
type Tokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string }

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject('migrations') as D1Migration[])
})

function request(path: string, init: RequestInit = {}) {
  return app.fetch(new Request(new URL(path, issuer), init), env)
}

async function body(response: Response): Promise<Json> {
  return await response.json() as Json
}

async function sessionCookie(token: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)}`
}

async function fixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const owner = `oauth-owner-${suffix}`
  const other = `oauth-other-${suffix}`
  const workspace = `oauth-ws-${suffix}`
  const otherWorkspace = `oauth-other-ws-${suffix}`
  const site = `oauth-site-${suffix}`
  const otherSite = `oauth-other-site-${suffix}`
  const ownerSession = `oauth-session-${suffix}`
  const otherSession = `oauth-other-session-${suffix}`
  const key = `vc_live_${suffix.replace(/-/g, '')}`
  const keyHash = await hashApiToken(key, env.TOKEN_PEPPER)

  await env.DB.batch([
    env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(owner, 'OAuth owner', `${owner}@example.test`, now, now),
    env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(other, 'Other owner', `${other}@example.test`, now, now),
    env.DB.prepare('INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(ownerSession, ownerSession, owner, now + 86400, now, now),
    env.DB.prepare('INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(otherSession, otherSession, other, now + 86400, now, now),
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(workspace, 'OAuth workspace', workspace, now, now),
    env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(otherWorkspace, 'Other workspace', otherWorkspace, now, now),
    env.DB.prepare('INSERT INTO memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`oauth-member-${suffix}`, workspace, owner, 'owner', now, now),
    env.DB.prepare('INSERT INTO memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`oauth-other-member-${suffix}`, otherWorkspace, other, 'owner', now, now),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(site, workspace, 'OAuth blog', site, now, now),
    env.DB.prepare('INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(otherSite, otherWorkspace, 'Other blog', otherSite, now, now),
    env.DB.prepare(`INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`oauth-key-${suffix}`, site, 'Existing key', key.slice(0, 18), keyHash,
        JSON.stringify(AGENT_TOKEN_PRESETS.draft), 'Existing key', owner, now, now),
  ])
  return { ownerCookie: await sessionCookie(ownerSession), otherCookie: await sessionCookie(otherSession), site, otherSite, workspace, key }
}

async function register(redirect = callback): Promise<Client> {
  const response = await request('/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test client', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
  })
  expect(response.status).toBe(201)
  const result = await body(response)
  expect(result.client_id).toMatch(/^vcc_/)
  return { id: result.client_id, redirect }
}

async function challenge() {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function authorize(client: Client, redirect = client.redirect, scope: string | null = scopes, responseType = 'code') {
  const query = new URLSearchParams({
    response_type: responseType, client_id: client.id, redirect_uri: redirect,
    code_challenge: await challenge(), code_challenge_method: 'S256',
    resource, state: 'test-state',
  })
  if (scope !== null) query.set('scope', scope)
  return request(`/oauth/authorize?${query}`)
}

async function pending(client: Client, cookie: string) {
  const response = await authorize(client)
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location')!, issuer)
  expect(location.origin + location.pathname).toBe(`${issuer}/authorize`)
  const id = location.searchParams.get('request')!
  expect(id).toBeTruthy()
  const view = await request(`/api/dashboard/oauth/requests/${encodeURIComponent(id)}`, { headers: { cookie } })
  expect(view.status).toBe(200)
  return id
}

async function approve(f: Fixture, registeredClient?: Client): Promise<Authorization> {
  const client = registeredClient ?? await register()
  const id = await pending(client, f.ownerCookie)
  const response = await request(`/api/dashboard/oauth/requests/${encodeURIComponent(id)}/approve`, {
    method: 'POST', headers: { cookie: f.ownerCookie, origin: issuer, 'content-type': 'application/json' },
    body: JSON.stringify({ siteId: f.site, level: 'draft' }),
  })
  expect(response.status).toBe(200)
  const redirect = new URL((await body(response)).redirectTo)
  expect(`${redirect.origin}${redirect.pathname}`).toBe(`${new URL(client.redirect).origin}${new URL(client.redirect).pathname}`)
  expect(redirect.searchParams.get('state')).toBe('test-state')
  expect(redirect.searchParams.get('iss')).toBe(issuer)
  const code = redirect.searchParams.get('code')!
  expect(code).toBeTruthy()
  return { client, id, code }
}

function exchange(auth: Authorization, overrides: Record<string, string> = {}) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code', client_id: auth.client.id, code: auth.code,
    redirect_uri: auth.client.redirect, code_verifier: verifier, resource, ...overrides,
  })
  return request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
}

function refresh(client: Client, token: string) {
  return request('/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.id, refresh_token: token }),
  })
}

async function connect(f: Fixture) {
  const auth = await approve(f)
  const response = await exchange(auth)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  const tokens = await body(response) as Tokens
  expect(tokens.access_token).toMatch(/^vc_oat_/)
  expect(tokens.refresh_token).toMatch(/^vc_ort_/)
  expect(tokens.token_type.toLowerCase()).toBe('bearer')
  expect(tokens.expires_in).toBe(3600)
  expect(tokens.scope.split(' ').sort()).toEqual([...AGENT_TOKEN_PRESETS.draft].sort())
  return { ...auth, tokens }
}

async function call(f: Fixture, token: string | null, name: string, args: Json = {}) {
  // The worker test pool deliberately sets the per-workspace budget to one call.
  await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(f.workspace).run()
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  return request('/mcp', {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
}

function discovery(method: 'initialize' | 'tools/list' | 'server/discover' | 'notifications/initialized', token: string | null = null) {
  const modern = method === 'server/discover' || method === 'tools/list'
  const version = '2026-07-28'
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  if (modern) {
    headers.set('MCP-Protocol-Version', version)
    headers.set('Mcp-Method', method)
  }
  return request('/mcp', {
    method: 'POST', headers,
    body: JSON.stringify({
      jsonrpc: '2.0', ...(method === 'notifications/initialized' ? {} : { id: 1 }), method,
      ...(modern ? { params: { _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientInfo': { name: 'oauth-test', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {},
      } } } : {}),
    }),
  })
}

async function tool(response: Response) {
  expect(response.status).toBe(200)
  return (await body(response)).result as Json
}

async function grantId(auth: Authorization) {
  const row = await env.DB.prepare('SELECT api_key_id FROM oauth_authorizations WHERE id = ?')
    .bind(auth.id).first<{ api_key_id: string }>()
  expect(row?.api_key_id).toBeTruthy()
  return row!.api_key_id
}

async function expectInvalidGrant(response: Response) {
  expect(response.status).toBe(400)
  const json = await body(response)
  expect(json.error).toBe('invalid_grant')
  expect(json.access_token).toBeUndefined()
  expect(json.refresh_token).toBeUndefined()
}

async function expectChallenge(response: Response, invalid = true) {
  expect(response.status).toBe(401)
  const header = response.headers.get('www-authenticate')
  expect(header).toMatch(/^Bearer /i)
  if (invalid) expect(header).toContain('error="invalid_token"')
  else expect(header).not.toContain('error="invalid_token"')
  expect(header).toContain(`scope="${AGENT_TOKEN_PRESETS.manage.join(' ')}"`)
  const metadataUrl = header?.match(/resource_metadata="([^"]+)"/)?.[1]
  expect(metadataUrl).toBe(`${issuer}/.well-known/oauth-protected-resource/mcp`)
  const metadata = await request(metadataUrl!)
  expect(metadata.status).toBe(200)
  expect(metadata.headers.get('access-control-allow-origin')).toBe('*')
  expect(await body(metadata)).toMatchObject({ resource, authorization_servers: [issuer] })
  expect(await body(response)).toMatchObject({ jsonrpc: '2.0', error: { code: -32001 } })
}

describe('OAuth sign-in approved behaviors', () => {
  it('1: Write drafts creates and edits drafts but cannot publish', async () => {
    const f = await fixture()
    const metadata = await request('/.well-known/oauth-authorization-server')
    expect(metadata.status).toBe(200)
    expect(await body(metadata)).toMatchObject({ issuer, registration_endpoint: `${issuer}/oauth/register`, token_endpoint: `${issuer}/oauth/token` })
    const { tokens } = await connect(f)
    const created = await tool(await call(f, tokens.access_token, 'posts.create', {
      title: 'OAuth draft', slug: 'oauth-draft', contentMarkdown: '# First draft',
    }))
    expect(created.isError).not.toBe(true)
    const postId = created.structuredContent.id as string
    expect(postId).toBeTruthy()
    const updated = await tool(await call(f, tokens.access_token, 'posts.update', {
      postId, expectedVersionNumber: 1, contentMarkdown: '# Edited draft',
    }))
    expect(updated.isError).not.toBe(true)
    expect(updated.structuredContent.contentMarkdown).toBe('# Edited draft')
    const denied = await tool(await call(f, tokens.access_token, 'posts.publish', { postId, expectedVersionNumber: 2 }))
    expect(denied).toMatchObject({ isError: true, structuredContent: { code: 'FORBIDDEN' } })
    expect(await env.DB.prepare('SELECT status, published_at, content_markdown FROM posts WHERE id = ?').bind(postId).first())
      .toMatchObject({ status: 'draft', published_at: null, content_markdown: '# Edited draft' })
  })

  it('2: a connection to blog A cannot read or change blog B', async () => {
    const f = await fixture()
    const postId = `foreign-${crypto.randomUUID()}`
    const now = Math.floor(Date.now() / 1000)
    await env.DB.prepare(`INSERT INTO posts (id, site_id, title, slug, content_markdown, status, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at)
      VALUES (?, ?, 'Foreign', ?, '# Private', 'draft', 'human', 'other', 'human', 'other', ?, ?)`)
      .bind(postId, f.otherSite, postId, now, now).run()
    const { tokens } = await connect(f)
    const read = await tool(await call(f, tokens.access_token, 'posts.get', { postId }))
    expect(read).toMatchObject({ isError: true, structuredContent: { code: 'NOT_FOUND' } })
    const edit = await tool(await call(f, tokens.access_token, 'posts.update', { postId, expectedVersionNumber: 1, contentMarkdown: '# Changed' }))
    expect(edit).toMatchObject({ isError: true, structuredContent: { code: 'NOT_FOUND' } })
    expect(await env.DB.prepare('SELECT content_markdown FROM posts WHERE id = ?').bind(postId).first())
      .toMatchObject({ content_markdown: '# Private' })
  })

  it('3: disconnect immediately rejects MCP and refresh', async () => {
    const f = await fixture()
    const auth = await connect(f)
    const id = await grantId(auth)
    const disconnected = await request('/api/dashboard/api-keys/revoke', {
      method: 'POST', headers: { cookie: f.ownerCookie, origin: issuer, 'content-type': 'application/json' },
      body: JSON.stringify({ keyId: id }),
    })
    expect(disconnected.status).toBe(200)
    expect(await body(disconnected)).toMatchObject({ kind: 'ok' })
    await expectChallenge(await call(f, auth.tokens.access_token, 'sites.get'))
    await expectInvalidGrant(await refresh(auth.client, auth.tokens.refresh_token))
  })

  it('revoking a refresh token disconnects the grant and invalidates its access token', async () => {
    const f = await fixture()
    const auth = await connect(f)
    const id = await grantId(auth)
    const list = async () => {
      const response = await request('/api/dashboard/connect', { headers: { cookie: f.ownerCookie } })
      expect(response.status).toBe(200)
      return (await body(response)).apiKeys as Array<{ id: string; connection: unknown }>
    }
    expect(await list()).toContainEqual(expect.objectContaining({
      id, connection: expect.objectContaining({ clientName: 'Test client', registration: 'dcr' }),
    }))
    expect((await tool(await call(f, auth.tokens.access_token, 'sites.get'))).isError).not.toBe(true)

    const revoked = await request('/oauth/revoke', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: auth.tokens.refresh_token, token_type_hint: 'refresh_token', client_id: auth.client.id }),
    })
    expect(revoked.status).toBe(200)
    expect((await list()).map((key) => key.id)).not.toContain(id)
    const grant = await env.DB.prepare('SELECT revoked_at FROM api_keys WHERE id = ?').bind(id).first<{ revoked_at: number | null }>()
    expect(grant).not.toBeNull()
    expect(grant!.revoked_at).not.toBeNull()
    await expectChallenge(await call(f, auth.tokens.access_token, 'sites.get'))
    await expectInvalidGrant(await refresh(auth.client, auth.tokens.refresh_token))
  })

  it('defaults an omitted scope to publish permissions', async () => {
    const f = await fixture()
    const client = await register()
    const response = await authorize(client, client.redirect, null)
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!, issuer)
    expect(location.pathname).toBe('/authorize')
    const id = location.searchParams.get('request')!
    expect(id).toBeTruthy()
    const view = await request(`/api/dashboard/oauth/requests/${encodeURIComponent(id)}`, { headers: { cookie: f.ownerCookie } })
    expect(view.status).toBe(200)
    const consent = await body(view)
    expect(consent.requestedScopes).toEqual(AGENT_TOKEN_PRESETS.manage)
    expect(consent.suggestedLevel).toBe('publish')
    const approved = await request(`/api/dashboard/oauth/requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST', headers: { cookie: f.ownerCookie, origin: issuer, 'content-type': 'application/json' },
      body: JSON.stringify({ siteId: f.site, level: 'publish' }),
    })
    expect(approved.status).toBe(200)
    const code = new URL((await body(approved)).redirectTo).searchParams.get('code')!
    expect(code).toBeTruthy()
    const tokenResponse = await exchange({ client, id, code })
    expect(tokenResponse.status).toBe(200)
    expect((await body(tokenResponse)).scope.split(' ').sort()).toEqual([...AGENT_TOKEN_PRESETS.publish].sort())
  })

  it('rejects unsupported response types for registered clients without redirecting', async () => {
    const client = await register()
    const response = await authorize(client, client.redirect, scopes, 'token')
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toContain("Can't sign in")
  })

  it('4: unregistered and look-alike redirect URIs never redirect or issue a code', async () => {
    const client = await register()
    const loopback = await register('http://localhost/callback?source=agent')
    for (const [registered, redirect] of [
      [client, 'https://client.example/callback/extra?source=agent'],
      [client, 'https://client.example/callback?source=other'],
      [client, 'https://attacker.example/callback?source=agent'],
      [loopback, 'http://localhost.evil.com/callback?source=agent'],
      [loopback, 'http://localhost:9999/other?source=agent'],
      [loopback, 'http://localhost:9999/callback?source=other'],
    ] as const) {
      const response = await authorize(registered, redirect)
      expect(response.status).not.toBe(302)
      expect(response.headers.get('location')).toBeNull()
      expect(await response.text()).not.toContain('code=')
    }
    const validLoopback = await authorize(loopback, 'http://localhost:9999/callback?source=agent')
    expect(validLoopback.status).toBe(302)
    expect(new URL(validLoopback.headers.get('location')!, issuer).pathname).toBe('/authorize')
  })

  it('5: codes require matching verifier, client and redirect and exchange only once, even concurrently', async () => {
    const f = await fixture()
    const auth = await approve(f)
    const otherClient = await register()
    await expectInvalidGrant(await exchange(auth, { code_verifier: 'b'.repeat(64) }))
    await expectInvalidGrant(await exchange(auth, { client_id: otherClient.id }))
    await expectInvalidGrant(await exchange(auth, { redirect_uri: 'https://client.example/callback?source=changed' }))
    const successful = await exchange(auth)
    expect(successful.status).toBe(200)
    const tokens = await body(successful)
    expect(tokens.access_token).toMatch(/^vc_oat_/)
    await expectInvalidGrant(await exchange(auth))
    await expectChallenge(await call(f, tokens.access_token, 'sites.get'))

    const concurrentAuth = await approve(f, await register())
    const responses = await Promise.all([exchange(concurrentAuth), exchange(concurrentAuth)])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
    const winner = await body(responses.find((response) => response.status === 200)!)
    expect(winner.access_token).toMatch(/^vc_oat_/)
    await expectInvalidGrant(responses.find((response) => response.status === 400)!)
  })

  it('6: refresh rotation tolerates immediate reuse but old reuse after grace disconnects the family', async () => {
    const f = await fixture()
    const auth = await connect(f)
    const rotation = await refresh(auth.client, auth.tokens.refresh_token)
    expect(rotation.status).toBe(200)
    const rotated = await body(rotation) as Tokens
    expect(rotated.refresh_token).toMatch(/^vc_ort_/)
    expect(rotated.refresh_token).not.toBe(auth.tokens.refresh_token)
    await expectInvalidGrant(await refresh(auth.client, auth.tokens.refresh_token))
    const stillActive = await tool(await call(f, rotated.access_token, 'sites.get'))
    expect(stillActive.isError).not.toBe(true)

    const hash = await hashApiToken(auth.tokens.refresh_token, env.TOKEN_PEPPER)
    await env.DB.prepare('UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ?')
      .bind(Math.floor(Date.now() / 1000) - 61, hash).run()
    await expectInvalidGrant(await refresh(auth.client, auth.tokens.refresh_token))
    await expectChallenge(await call(f, rotated.access_token, 'sites.get'))
    await expectInvalidGrant(await refresh(auth.client, rotated.refresh_token))
    const grant = await env.DB.prepare('SELECT revoked_at FROM api_keys WHERE id = ?').bind(await grantId(auth)).first<{ revoked_at: number | null }>()
    expect(grant).not.toBeNull()
    expect(grant!.revoked_at).not.toBeNull()
    const family = await env.DB.prepare('SELECT COUNT(*) AS count FROM oauth_tokens WHERE family_id = ? AND revoked_at IS NULL')
      .bind(auth.id).first<{ count: number }>()
    expect(family?.count).toBe(0)

    const concurrent = await connect(f)
    const responses = await Promise.all([
      refresh(concurrent.client, concurrent.tokens.refresh_token),
      refresh(concurrent.client, concurrent.tokens.refresh_token),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
    const winner = await body(responses.find((response) => response.status === 200)!) as Tokens
    expect(winner.refresh_token).toMatch(/^vc_ort_/)
    await expectInvalidGrant(responses.find((response) => response.status === 400)!)
    expect((await tool(await call(f, winner.access_token, 'sites.get'))).isError).not.toBe(true)
  })

  it('7: missing, invalid and expired bearer challenges point to exact MCP resource metadata', async () => {
    const f = await fixture()
    await expectChallenge(await call(f, null, 'sites.get'), false)
    for (const method of ['initialize', 'tools/list', 'server/discover', 'notifications/initialized'] as const) {
      await expectChallenge(await discovery(method), false)
    }
    await expectChallenge(await call(f, 'vc_oat_invalid', 'sites.get'))
    const auth = await connect(f)
    const hash = await hashApiToken(auth.tokens.access_token, env.TOKEN_PEPPER)
    await env.DB.prepare('UPDATE oauth_tokens SET expires_at = ? WHERE token_hash = ?')
      .bind(Math.floor(Date.now() / 1000) - 1, hash).run()
    await expectChallenge(await call(f, auth.tokens.access_token, 'sites.get'))
  })

  it('8: another user and cross-origin requests cannot approve consent; deny creates no grant', async () => {
    const f = await fixture()
    const client = await register()
    const id = await pending(client, f.ownerCookie)
    const path = `/api/dashboard/oauth/requests/${encodeURIComponent(id)}`
    const payload = JSON.stringify({ siteId: f.site, level: 'draft' })
    const other = await request(`${path}/approve`, {
      method: 'POST', headers: { cookie: f.otherCookie, origin: issuer, 'content-type': 'application/json' }, body: payload,
    })
    expect(other.status).toBe(404)
    const crossOrigin = await request(`${path}/approve`, {
      method: 'POST', headers: { cookie: f.ownerCookie, origin: 'https://attacker.example', 'content-type': 'application/json' }, body: payload,
    })
    expect(crossOrigin.status).toBe(403)
    const deny = await request(`${path}/deny`, {
      method: 'POST', headers: { cookie: f.ownerCookie, origin: issuer, 'content-type': 'application/json' }, body: '{}',
    })
    expect(deny.status).toBe(200)
    const redirect = new URL((await body(deny)).redirectTo)
    expect(redirect.searchParams.get('error')).toBe('access_denied')
    expect(redirect.searchParams.get('code')).toBeNull()
    expect(redirect.searchParams.get('state')).toBe('test-state')
    expect(redirect.searchParams.get('iss')).toBe(issuer)
    const grants = await env.DB.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE oauth_client_id = ?').bind(client.id).first<{ count: number }>()
    expect(grants?.count).toBe(0)
  })

  it('9: existing agent keys work on MCP and REST while OAuth tokens are MCP-only', async () => {
    const f = await fixture()
    const keyCall = await tool(await call(f, f.key, 'sites.get'))
    expect(keyCall.isError).not.toBe(true)
    expect(keyCall.structuredContent.result.id).toBe(f.site)
    await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(f.workspace).run()
    const restKey = await request('/api/v1/site', { headers: { authorization: `Bearer ${f.key}` } })
    expect(restKey.status).toBe(200)
    expect(await body(restKey)).toMatchObject({ id: f.site })
    const auth = await connect(f)
    await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(f.workspace).run()
    const restOauth = await request('/api/v1/site', { headers: { authorization: `Bearer ${auth.tokens.access_token}` } })
    expect(restOauth.status).toBe(401)
    const oauthCall = await tool(await call(f, auth.tokens.access_token, 'sites.get'))
    expect(oauthCall.isError).not.toBe(true)
    expect(oauthCall.structuredContent.result.id).toBe(f.site)
    for (const token of [f.key, auth.tokens.access_token]) {
      await env.DB.prepare('DELETE FROM usage_counters WHERE workspace_id = ?').bind(f.workspace).run()
      const initialized = await discovery('initialize', token)
      expect(initialized.status).toBe(200)
      expect((await body(initialized)).result.protocolVersion).toBe('2025-11-25')
      const discovered = await discovery('server/discover', token)
      expect(discovered.status).toBe(200)
      expect((await body(discovered)).result).toMatchObject({ resultType: 'complete', cacheScope: 'public' })
      const listed = await discovery('tools/list', token)
      expect(listed.status).toBe(200)
      const catalog = (await body(listed)).result
      expect(catalog).toMatchObject({ resultType: 'complete', cacheScope: 'private' })
      expect(catalog.tools.length).toBeGreaterThan(0)
      expect(catalog.tools.every((tool: Json) => {
        const scope = tool._meta['vibecms.com/requiredScope']
        return scope === null || AGENT_TOKEN_PRESETS.draft.includes(scope)
      })).toBe(true)
      expect(catalog.tools.some((tool: Json) => tool.name === 'posts.publish')).toBe(false)
      expect((await discovery('notifications/initialized', token)).status).toBe(202)
    }
  })
})
