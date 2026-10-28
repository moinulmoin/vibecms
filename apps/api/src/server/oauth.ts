import { Hono } from 'hono'
import { AGENT_TOKEN_PRESETS } from '@vc/core'
import { createDataAccess } from '@vc/db'
import { allScopes, hashApiToken } from '@/server/api-keys'

export const CIMD_TRUSTED_HOSTS: readonly string[] = ['claude.ai', 'chatgpt.com']
export const oauthIssuer = (appUrl: string) => appUrl.replace(/\/+$/, '')
export const oauthResource = (appUrl: string) => `${oauthIssuer(appUrl)}/mcp`

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function randomOAuthToken(bytes: number) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}
export function oauthRedirect(redirectUri: string, params: Record<string, string | null>) {
  const url = new URL(redirectUri)
  for (const key of ['code', 'state', 'iss', 'error', 'error_description', 'error_uri']) url.searchParams.delete(key)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value)
  }
  return url.toString()
}

const now = () => Math.floor(Date.now() / 1000)
const docs = 'https://vibecms.dev/docs/getting-started/connect-an-agent'
const allowedScopes = [...allScopes, 'offline_access']
const pkcePattern = /^[A-Za-z0-9._~-]{43,128}$/
type Client = { id: string; registration: string; client_name: string; redirect_uris_json: string; metadata_fetched_at: number | null }
type OAuthEnv = { Bindings: Cloudflare.Env }
export const oauthRoutes = new Hono<OAuthEnv>()

// Examine the literal authority as well as URL's normalized hostname: URL parsing
// canonicalizes alternate IP encodings, which are not approved loopback hosts.
function redirectUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || /[\s\\\u0000-\u001f\u007f#]/.test(value)) return null
  try {
    const url = new URL(value)
    const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]+)/.exec(value)?.[1]
    if (!authority || authority.includes('@') || url.username || url.password || !url.hostname) return null
    if (url.protocol === 'https:') return url
    if (url.protocol !== 'http:') return null
    const host = authority.replace(/:\d+$/, '').toLowerCase()
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return null
    return url
  } catch { return null }
}
function matchesRedirect(registered: string, requested: string) {
  const a = redirectUrl(registered), b = redirectUrl(requested)
  if (!a || !b) return false
  if (registered === requested) return true
  const suffix = (value: string) => value.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+/, '')
  return a.protocol === 'http:' && b.protocol === 'http:' && a.hostname === b.hostname && suffix(registered) === suffix(requested)
}
function redirectList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > max || !value.every((v) => redirectUrl(v))) return null
  return value as string[]
}
function displayName(value: unknown) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim() || 'Unnamed app' : 'Unnamed app'
}
async function limitedBody(request: Request | Response, limit: number): Promise<string | null> {
  const length = request.headers.get('content-length')
  if (length && Number(length) > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); return null }
    chunks.push(value)
  }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(data)
}
async function rateLimit(env: Cloudflare.Env, request: Request, type: string, max: number) {
  try {
    const timestamp = now(), bucket = Math.floor(timestamp / 3600)
    const ip = request.headers.get('CF-Connecting-IP') || 'anon'
    const hash = await hashApiToken(ip, env.TOKEN_PEPPER ?? '')
    return (await createDataAccess(env.DB).rateLimits.increment({ id: `oauth:${type}:${hash}:${bucket}`, windowExpiresAt: (bucket + 1) * 3600, max, now: timestamp })).allowed
  } catch { return false }
}
function trustedMetadataUrl(id: string) {
  try {
    const url = new URL(id)
    return url.protocol === 'https:' && CIMD_TRUSTED_HOSTS.includes(url.hostname) && url.port === '' && !url.username && !url.password && url.pathname !== '/' && !url.search && !url.hash && !/[?#\\\s]/.test(id)
  } catch { return false }
}
async function resolveClient(env: Cloudflare.Env, id: string): Promise<Client | null> {
  const db = env.DB
  const cached = await db.prepare('SELECT id, registration, client_name, redirect_uris_json, metadata_fetched_at FROM oauth_clients WHERE id = ?').bind(id).first<Client>()
  if (cached?.registration === 'dcr') return cached
  if (!trustedMetadataUrl(id)) return null
  const timestamp = now()
  if (cached?.registration === 'cimd' && cached.metadata_fetched_at !== null && cached.metadata_fetched_at > timestamp - 3600) return cached
  let text: string | null
  try {
    const response = await fetch(id, { redirect: 'manual', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) })
    if (response.status >= 300 && response.status < 400) return null
    if (response.status !== 200) throw new Error('metadata unavailable')
    text = await limitedBody(response, 32768)
  } catch {
    return cached?.registration === 'cimd' && cached.metadata_fetched_at !== null && cached.metadata_fetched_at > timestamp - 7 * 86400 ? cached : null
  }
  if (text === null) return null
  let doc: unknown
  try { doc = JSON.parse(text) } catch { return null }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const data = doc as Record<string, unknown>
  const redirects = redirectList(data.redirect_uris, 20)
  const methods = data.token_endpoint_auth_methods_supported
  if (data.client_id !== id || !redirects || !(data.token_endpoint_auth_method === undefined || data.token_endpoint_auth_method === 'none' || (Array.isArray(methods) && methods.includes('none')))) return null
  const name = displayName(data.client_name).slice(0, 100)
  await db.prepare(`INSERT INTO oauth_clients (id, registration, client_name, redirect_uris_json, metadata_fetched_at, created_at, updated_at)
    VALUES (?, 'cimd', ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET client_name=excluded.client_name, redirect_uris_json=excluded.redirect_uris_json, metadata_fetched_at=excluded.metadata_fetched_at, updated_at=excluded.updated_at WHERE oauth_clients.registration='cimd'`)
    .bind(id, name, JSON.stringify(redirects), timestamp, timestamp, timestamp).run()
  return { id, registration: 'cimd', client_name: name, redirect_uris_json: JSON.stringify(redirects), metadata_fetched_at: timestamp }
}
function errorPage(message: string, status: 400 | 429 = 400) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Sign-in error</title></head><body><h1>Can't sign in</h1><p>${message}</p></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } })
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', Pragma: 'no-cache' }
function oauthError(error: string, description: string, status: 400 | 401 | 429 = 400) {
  return Response.json({ error, error_description: description }, { status, headers: cors })
}
async function parseParameters(request: Request): Promise<Record<string, unknown> | null> {
  const text = await limitedBody(request, 16384)
  if (text === null) return null
  const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase()
  try {
    if (contentType === 'application/json') {
      const value: unknown = JSON.parse(text)
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    }
    if (contentType === 'application/x-www-form-urlencoded') {
      const params = new URLSearchParams(text)
      const result: Record<string, unknown> = {}
      for (const [key, value] of params) { if (key in result) return null; result[key] = value }
      return result
    }
  } catch { return null }
  return null
}
const field = (body: Record<string, unknown>, key: string) => typeof body[key] === 'string' ? body[key] as string : ''

for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/oauth/register', '/oauth/token', '/oauth/revoke']) {
  oauthRoutes.use(path, async (c, next) => {
    await next()
    c.header('Access-Control-Allow-Origin', '*')
  })
}
oauthRoutes.options('/oauth/register', (c) => c.body(null, 204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': '*' }))
oauthRoutes.options('/oauth/token', (c) => c.body(null, 204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': '*' }))
oauthRoutes.options('/oauth/revoke', (c) => c.body(null, 204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Origin': '*' }))

oauthRoutes.get('/.well-known/oauth-protected-resource', (c) => c.json({ resource: oauthResource(c.env.APP_URL), authorization_servers: [oauthIssuer(c.env.APP_URL)], bearer_methods_supported: ['header'], scopes_supported: allScopes, resource_name: 'vibecms', resource_documentation: docs }))
oauthRoutes.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json({ resource: oauthResource(c.env.APP_URL), authorization_servers: [oauthIssuer(c.env.APP_URL)], bearer_methods_supported: ['header'], scopes_supported: allScopes, resource_name: 'vibecms', resource_documentation: docs }))
oauthRoutes.get('/.well-known/oauth-authorization-server', (c) => {
  const issuer = oauthIssuer(c.env.APP_URL)
  return c.json({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true, scopes_supported: allowedScopes, service_documentation: docs })
})

oauthRoutes.post('/oauth/register', async (c) => {
  if (!await rateLimit(c.env, c.req.raw, 'register', 100)) return oauthError('invalid_request', 'Registration rate limit exceeded.', 429)
  if (!(c.req.header('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return oauthError('invalid_client_metadata', 'Expected JSON.')
  const body = await parseParameters(c.req.raw)
  if (!body) return oauthError('invalid_client_metadata', 'Invalid registration metadata.')
  const redirects = redirectList(body.redirect_uris, 10)
  const subset = (value: unknown, allowed: string[]) => value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string' && allowed.includes(item)))
  if (!redirects || (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') || !subset(body.grant_types, ['authorization_code', 'refresh_token']) || !subset(body.response_types, ['code']) || (body.client_name !== undefined && (typeof body.client_name !== 'string' || body.client_name.length > 100))) return oauthError('invalid_client_metadata', 'Invalid registration metadata.')
  const id = `vcc_${randomOAuthToken(16)}`, timestamp = now(), name = displayName(body.client_name)
  await c.env.DB.prepare(`INSERT INTO oauth_clients (id, registration, client_name, redirect_uris_json, created_at, updated_at) VALUES (?, 'dcr', ?, ?, ?, ?)`).bind(id, name, JSON.stringify(redirects), timestamp, timestamp).run()
  return c.json({ client_id: id, client_id_issued_at: timestamp, client_name: name, redirect_uris: redirects, token_endpoint_auth_method: 'none', grant_types: body.grant_types ?? ['authorization_code', 'refresh_token'], response_types: body.response_types ?? ['code'] }, 201, cors)
})

oauthRoutes.get('/oauth/authorize', async (c) => {
  if (!await rateLimit(c.env, c.req.raw, 'authorize', 60)) return errorPage('Too many sign-in requests. Try again later.', 429)
  const query = new URL(c.req.url).searchParams
  const id = query.get('client_id') ?? '', redirect = query.get('redirect_uri') ?? ''
  const client = await resolveClient(c.env, id)
  if (!client || !redirectUrl(redirect)) return errorPage('The app or return address is not valid.')
  let redirects: unknown
  try { redirects = JSON.parse(client.redirect_uris_json) } catch { return errorPage('The app or return address is not valid.') }
  if (!Array.isArray(redirects) || !redirects.some((registered) => typeof registered === 'string' && matchesRedirect(registered, redirect))) return errorPage('The app or return address is not valid.')
  const state = query.get('state'), issuer = oauthIssuer(c.env.APP_URL), resource = oauthResource(c.env.APP_URL)
  const fail = (error: string, description: string) => client.registration === 'dcr'
    ? errorPage(description)
    : c.redirect(oauthRedirect(redirect, { error, error_description: description, state, iss: issuer }), 302)
  if (query.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only authorization code is supported.')
  const challenge = query.get('code_challenge') ?? ''
  if (!pkcePattern.test(challenge) || query.get('code_challenge_method') !== 'S256') return fail('invalid_request', 'A valid S256 code challenge is required.')
  if (query.has('resource') && query.get('resource') !== resource) return fail('invalid_target', 'Invalid resource.')
  const scopes = (query.get('scope') ?? AGENT_TOKEN_PRESETS.manage.join(' ')).split(/\s+/).filter(Boolean)
  if (scopes.some((scope) => !allowedScopes.includes(scope))) return fail('invalid_scope', 'Unknown scope.')
  if (state !== null && state.length > 1000) return fail('invalid_request', 'State is too long.')
  const authorizationId = randomOAuthToken(32), timestamp = now()
  await c.env.DB.prepare(`INSERT INTO oauth_authorizations (id, client_id, redirect_uri, state, scope, resource, code_challenge, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .bind(authorizationId, id, redirect, state, scopes.filter((scope) => scope !== 'offline_access').join(' '), resource, challenge, timestamp + 600, timestamp, timestamp).run()
  return c.redirect(`${issuer}/authorize?request=${encodeURIComponent(authorizationId)}`, 302)
})

type TokenGrant = {
  api_key_id: string
  client_id: string
  family_id: string
  resource: string
  scopes_json: string
  revoked_at: number | null
  owner: number
}

// Recheck ownership in the guarded transition as well as on reading.
const ownerExists = `EXISTS (SELECT 1 FROM api_keys k JOIN sites s ON s.id = k.site_id
  JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = k.created_by_user_id AND m.role = 'owner'
  JOIN "user" u ON u.id = k.created_by_user_id WHERE k.id = ? AND k.revoked_at IS NULL)`

export async function revokeGrant(
  db: D1Database,
  keyId: string,
  timestamp: number,
  reason: 'replay' | 'ownership' | 'client' | 'abandoned',
  authorizationId?: string,
) {
  if (reason === 'abandoned' && !authorizationId) throw new Error('An abandoned grant requires an authorization ID')
  // Recheck the authorization inside the batch: it may have been exchanged
  // after cleanup selected it but before the revocation began.
  const guard = `(? IS NULL OR EXISTS (SELECT 1 FROM oauth_authorizations a
    WHERE a.id = ? AND a.api_key_id = ? AND a.status = 'approved' AND a.code_expires_at < ?))`
  const authId = reason === 'abandoned' ? authorizationId! : null
  const summary = {
    replay: "'Disconnected ' || name || ': an old sign-in token was reused'",
    ownership: "'Disconnected sign-in: blog ownership changed'",
    client: "'Disconnected by ' || name",
    abandoned: "'Disconnected ' || name || ': sign-in was not completed'",
  }[reason]
  await db.batch([
    db.prepare(`INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
      SELECT ?, site_id, 'system', 'system', 'System', 'api_key.revoked', 'api_key', id, ${summary}, ?
      FROM api_keys WHERE id = ? AND revoked_at IS NULL AND ${guard}`)
      .bind(crypto.randomUUID(), timestamp, keyId, authId, authId, keyId, timestamp - 300),
    db.prepare(`UPDATE api_keys SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL AND ${guard}`)
      .bind(timestamp, timestamp, keyId, authId, authId, keyId, timestamp - 300),
    db.prepare(`UPDATE oauth_tokens SET revoked_at = ? WHERE api_key_id = ? AND revoked_at IS NULL AND ${guard}`)
      .bind(timestamp, keyId, authId, authId, keyId, timestamp - 300),
  ])
}
async function tokenPair(db: D1Database, grant: TokenGrant, transition: D1PreparedStatement, timestamp: number) {
  const access = `vc_oat_${randomOAuthToken(32)}`, refresh = `vc_ort_${randomOAuthToken(32)}`
  const [accessHash, refreshHash] = await Promise.all([hashApiToken(access), hashApiToken(refresh)])
  const results = await db.batch([
    transition,
    db.prepare(`INSERT INTO oauth_tokens (token_hash, kind, api_key_id, client_id, family_id, resource, expires_at, created_at)
      SELECT ?, 'access', ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(accessHash, grant.api_key_id, grant.client_id, grant.family_id, grant.resource, timestamp + 3600, timestamp),
    db.prepare(`INSERT INTO oauth_tokens (token_hash, kind, api_key_id, client_id, family_id, resource, expires_at, created_at)
      SELECT ?, 'refresh', ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM oauth_tokens WHERE token_hash = ?)`)
      .bind(refreshHash, grant.api_key_id, grant.client_id, grant.family_id, grant.resource, timestamp + 30 * 86400, timestamp, accessHash),
  ])
  if ((results[0]?.meta.changes ?? 0) !== 1) return null
  return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: (JSON.parse(grant.scopes_json) as string[]).join(' ') }
}

oauthRoutes.post('/oauth/token', async (c) => {
  const body = await parseParameters(c.req.raw)
  if (!body) return oauthError('invalid_request', 'Invalid request body.')
  const clientId = field(body, 'client_id'), grantType = field(body, 'grant_type')
  if (!clientId || !grantType) return oauthError('invalid_request', 'client_id and grant_type are required.')
  const client = await c.env.DB.prepare('SELECT id FROM oauth_clients WHERE id = ?').bind(clientId).first()
  if (!client) return oauthError('invalid_client', 'Unknown client.', 401)
  const db = c.env.DB, timestamp = now(), resource = oauthResource(c.env.APP_URL)
  if (body.resource !== undefined && body.resource !== resource) return oauthError('invalid_grant', 'Invalid resource.')
  const invalid = () => oauthError('invalid_grant', 'The authorization grant is invalid or expired.')

  if (grantType === 'authorization_code') {
    const code = field(body, 'code'), redirect = field(body, 'redirect_uri'), verifier = field(body, 'code_verifier')
    if (!code || !redirect || !pkcePattern.test(verifier)) return oauthError('invalid_request', 'code, redirect_uri and a valid code_verifier are required.')
    const codeHash = await hashApiToken(code)
    const auth = await db.prepare(`SELECT a.id AS family_id, a.api_key_id, a.client_id, a.resource, a.redirect_uri, a.code_challenge,
        a.status, a.code_expires_at, k.scopes_json, k.revoked_at,
        EXISTS (SELECT 1 FROM sites s JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = k.created_by_user_id AND m.role = 'owner' JOIN "user" u ON u.id = k.created_by_user_id WHERE s.id = k.site_id) AS owner
      FROM oauth_authorizations a JOIN api_keys k ON k.id = a.api_key_id WHERE a.code_hash = ?`)
      .bind(codeHash).first<TokenGrant & { redirect_uri: string; code_challenge: string; status: string; code_expires_at: number | null }>()
    if (!auth || auth.client_id !== clientId || auth.redirect_uri !== redirect || auth.resource !== resource) return invalid()
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
    if (challenge !== auth.code_challenge) return invalid()
    if (auth.status === 'exchanged') {
      await db.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL').bind(timestamp, auth.family_id).run()
      return invalid()
    }
    if (auth.status !== 'approved' || auth.code_expires_at === null || auth.code_expires_at <= timestamp || auth.revoked_at !== null) return invalid()
    if (!auth.owner) { await revokeGrant(db, auth.api_key_id, timestamp, 'ownership'); return invalid() }
    const transition = db.prepare(`UPDATE oauth_authorizations SET status = 'exchanged', updated_at = ?
      WHERE id = ? AND status = 'approved' AND code_expires_at > ? AND ${ownerExists}`)
      .bind(timestamp, auth.family_id, timestamp, auth.api_key_id)
    const pair = await tokenPair(db, auth, transition, timestamp)
    if (!pair) {
      const current = await db.prepare('SELECT status FROM oauth_authorizations WHERE id = ?').bind(auth.family_id).first<{ status: string }>()
      if (current?.status === 'exchanged') await db.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL').bind(timestamp, auth.family_id).run()
      return invalid()
    }
    return Response.json(pair, { headers: cors })
  }

  if (grantType === 'refresh_token') {
    const refresh = field(body, 'refresh_token')
    if (!refresh) return oauthError('invalid_request', 'refresh_token is required.')
    const hash = await hashApiToken(refresh)
    const token = await db.prepare(`SELECT t.api_key_id, t.client_id, t.family_id, t.resource, t.used_at, t.revoked_at AS token_revoked_at,
        t.expires_at, k.scopes_json, k.revoked_at,
        EXISTS (SELECT 1 FROM sites s JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = k.created_by_user_id AND m.role = 'owner' JOIN "user" u ON u.id = k.created_by_user_id WHERE s.id = k.site_id) AS owner
      FROM oauth_tokens t JOIN api_keys k ON k.id = t.api_key_id WHERE t.token_hash = ? AND t.kind = 'refresh'`)
      .bind(hash).first<TokenGrant & { used_at: number | null; token_revoked_at: number | null; expires_at: number }>()
    if (!token || token.client_id !== clientId || token.resource !== resource) return invalid()
    if (token.used_at !== null) {
      if (token.used_at < timestamp - 60 && token.token_revoked_at === null && token.revoked_at === null) await revokeGrant(db, token.api_key_id, timestamp, 'replay')
      return invalid()
    }
    if (token.revoked_at !== null || token.token_revoked_at !== null || token.expires_at <= timestamp) return invalid()
    if (!token.owner) { await revokeGrant(db, token.api_key_id, timestamp, 'ownership'); return invalid() }
    const transition = db.prepare(`UPDATE oauth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND ${ownerExists}`)
      .bind(timestamp, hash, timestamp, token.api_key_id)
    const pair = await tokenPair(db, token, transition, timestamp)
    return pair ? Response.json(pair, { headers: cors }) : invalid()
  }
  return oauthError('unsupported_grant_type', 'Unsupported grant type.')
})

oauthRoutes.post('/oauth/revoke', async (c) => {
  const body = await parseParameters(c.req.raw)
  if (!body) return oauthError('invalid_request', 'Invalid request body.')
  const raw = field(body, 'token'), clientId = field(body, 'client_id')
  if (!raw || !clientId) return oauthError('invalid_request', 'token and client_id are required.')
  const hash = await hashApiToken(raw), timestamp = now()
  const token = await c.env.DB.prepare('SELECT kind, api_key_id FROM oauth_tokens WHERE token_hash = ? AND client_id = ?').bind(hash, clientId).first<{ kind: string; api_key_id: string }>()
  if (token?.kind === 'refresh') await revokeGrant(c.env.DB, token.api_key_id, timestamp, 'client')
  else if (token?.kind === 'access') await c.env.DB.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(timestamp, hash).run()
  return new Response(null, { status: 200, headers: cors })
})
