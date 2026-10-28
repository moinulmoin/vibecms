import { Hono } from 'hono'
import { env } from 'cloudflare:workers'
import { API_TOKENS_MAX } from '@vc/config'
import { AGENT_TOKEN_PRESETS } from '@vc/core'
import { auth } from '@/server/auth'
import { isAppContextHost } from '@/server/canonical-host'
import { rejectCrossOriginBrowserPost } from '@/server/csrf'
import { hashApiToken } from '@/server/api-keys'
import { listUserAppChoices } from '@/server/onboarding'
import { getSitePublicBaseUrl } from '@/server/site-public-url'
import { CIMD_TRUSTED_HOSTS, oauthIssuer, oauthRedirect, randomOAuthToken } from '@/server/oauth'

type ConsentRequest = {
  id: string
  client_id: string
  client_name: string
  registration: 'dcr' | 'cimd'
  redirect_uri: string
  state: string | null
  scope: string
  status: string
  user_id: string | null
  expires_at: number
}

type Level = 'draft' | 'publish' | 'manage'
const levelLabels: Record<Level, string> = {
  draft: 'Write drafts',
  publish: 'Write and publish',
  manage: 'Manage',
}

const timestamp = () => Math.floor(Date.now() / 1000)
const unauthorized = () => Response.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 })
const expired = () => Response.json({ code: 'expired' }, { status: 410 })
const notFound = () => Response.json({ error: { code: 'NOT_FOUND', message: 'Request not found' } }, { status: 404 })
const forbidden = () => Response.json({ error: { code: 'FORBIDDEN', message: 'Only the blog owner can connect an app.' } }, { status: 403 })
const invalid = (message: string) => Response.json({ error: { code: 'VALIDATION_ERROR', message } }, { status: 400 })

async function sessionUser(request: Request) {
  const host = new URL(request.url).hostname
  if (!isAppContextHost(host, { appHost: new URL(env.APP_URL).hostname })) return null
  return (await auth.api.getSession({ headers: request.headers }))?.user ?? null
}

async function loadRequest(id: string): Promise<ConsentRequest | null> {
  return env.DB.prepare(
    `SELECT a.id, a.client_id, c.client_name, c.registration, a.redirect_uri, a.state,
            a.scope, a.status, a.user_id, a.expires_at
     FROM oauth_authorizations a JOIN oauth_clients c ON c.id = a.client_id WHERE a.id = ?`,
  ).bind(id).first<ConsentRequest>()
}

function requestError(request: ConsentRequest | null, userId: string, now: number): Response | null {
  if (!request || request.status !== 'pending' || request.expires_at <= now) return expired()
  if (request.user_id !== null && request.user_id !== userId) return notFound()
  return null
}

function clientHost(request: ConsentRequest): string {
  return new URL(request.registration === 'cimd' ? request.client_id : request.redirect_uri).hostname
}

export const dashboardOAuthRoutes = new Hono()

dashboardOAuthRoutes.get('/requests/:id', async (c) => {
  const user = await sessionUser(c.req.raw)
  if (!user) return unauthorized()
  const now = timestamp()
  await env.DB.prepare(
    `UPDATE oauth_authorizations SET user_id = ?, updated_at = ?
     WHERE id = ? AND status = 'pending' AND expires_at > ? AND user_id IS NULL`,
  ).bind(user.id, now, c.req.param('id'), now).run()
  const request = await loadRequest(c.req.param('id'))
  const error = requestError(request, user.id, now)
  if (error) return error
  if (!request) return expired()

  const redirect = new URL(request.redirect_uri)
  const host = clientHost(request)
  const requested = new Set(request.scope.split(/\s+/))
  const blogs = await Promise.all((await listUserAppChoices(user.id))
    .filter((choice) => choice.role === 'owner')
    .map(async (choice) => ({
      siteId: choice.siteId,
      name: choice.siteName,
      url: await getSitePublicBaseUrl(choice.siteId, choice.siteSlug),
    })))
  return c.json({
    client: {
      name: request.client_name,
      host,
      trusted: request.registration === 'cimd' && CIMD_TRUSTED_HOSTS.includes(host),
      registration: request.registration,
    },
    redirect: {
      host: redirect.host,
      loopbackOnly: redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname),
    },
    requestedScopes: [...requested],
    // Manage is never preselected: the human must choose it explicitly.
    suggestedLevel: AGENT_TOKEN_PRESETS.publish.every((scope) => requested.has(scope)) ? 'publish'
      : AGENT_TOKEN_PRESETS.draft.every((scope) => requested.has(scope)) ? 'draft' : null,
    blogs,
    expiresAt: request.expires_at,
  })
})

dashboardOAuthRoutes.post('/requests/:id/approve', async (c) => {
  const blocked = rejectCrossOriginBrowserPost(c.req.raw)
  if (blocked) return blocked
  const user = await sessionUser(c.req.raw)
  if (!user) return unauthorized()
  const request = await loadRequest(c.req.param('id'))
  const error = requestError(request, user.id, timestamp())
  if (error) return error
  if (!request || request.user_id !== user.id) return notFound()

  let body: { siteId?: unknown; level?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return invalid('Choose a blog and access level.')
  }
  if (!body || typeof body.siteId !== 'string' || (body.level !== 'draft' && body.level !== 'publish' && body.level !== 'manage')) {
    return invalid('Choose a blog and access level.')
  }
  const siteId = body.siteId
  const level = body.level
  const scopes = AGENT_TOKEN_PRESETS[level]
  const requested = new Set(request.scope.split(/\s+/))
  if (!scopes.every((scope) => requested.has(scope))) {
    return invalid('This access level needs more permissions than the app requested. Start again from your app with the required permissions.')
  }

  const keyId = crypto.randomUUID()
  const code = randomOAuthToken(32)
  const [keyHash, codeHash] = await Promise.all([hashApiToken(randomOAuthToken(32)), hashApiToken(code)])
  const now = timestamp()
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, oauth_client_id, created_at, updated_at)
       SELECT ?, ?, ?, 'oauth', ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM oauth_authorizations WHERE id = ? AND status = 'pending' AND expires_at > ? AND user_id = ?)
         AND EXISTS (SELECT 1 FROM sites s JOIN memberships m ON m.workspace_id = s.workspace_id
                     WHERE s.id = ? AND m.user_id = ? AND m.role = 'owner')
         AND (SELECT COUNT(*) FROM api_keys WHERE site_id = ? AND revoked_at IS NULL
              AND (oauth_client_id IS NULL OR oauth_client_id != ? OR created_by_user_id != ?)) < ?`,
    ).bind(keyId, siteId, request.client_name, keyHash, JSON.stringify(scopes), request.client_name, user.id,
      request.client_id, now, now, request.id, now, user.id, siteId, user.id, siteId, request.client_id, user.id, API_TOKENS_MAX),
    env.DB.prepare(
      `UPDATE oauth_authorizations SET status = 'approved', user_id = ?, api_key_id = ?, code_hash = ?, code_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ? AND user_id = ?
         AND EXISTS (SELECT 1 FROM api_keys WHERE id = ?)`,
    ).bind(user.id, keyId, codeHash, now + 60, now, request.id, now, user.id, keyId),
    env.DB.prepare(
      `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, created_at)
       SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
                    substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
              site_id, 'human', ?, ?, 'api_key.revoked', 'api_key', id,
              'Disconnected ' || name || ': replaced by a new sign-in', NULL, NULL, ?
       FROM api_keys
       WHERE site_id = ? AND created_by_user_id = ? AND oauth_client_id = ? AND id != ? AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM oauth_authorizations WHERE id = ? AND status = 'approved' AND api_key_id = ?)`,
    ).bind(user.id, user.name || user.email, now, siteId, user.id, request.client_id, keyId, request.id, keyId),
    env.DB.prepare(
      `UPDATE api_keys SET revoked_at = ?, updated_at = ?
       WHERE site_id = ? AND created_by_user_id = ? AND oauth_client_id = ? AND id != ? AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM oauth_authorizations WHERE id = ? AND status = 'approved' AND api_key_id = ?)`,
    ).bind(now, now, siteId, user.id, request.client_id, keyId, request.id, keyId),
    env.DB.prepare(
      `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, created_at)
       SELECT ?, ?, 'human', ?, ?, 'api_key.created', 'api_key', ?, ?, NULL, NULL, ?
       WHERE EXISTS (SELECT 1 FROM oauth_authorizations WHERE id = ? AND status = 'approved' AND api_key_id = ?)`,
    ).bind(crypto.randomUUID(), siteId, user.id, user.name || user.email, keyId,
      `Connected ${request.client_name} (${clientHost(request)}) · ${levelLabels[level]}`, now, request.id, keyId),
  ])
  if (!results[0]?.meta.changes) {
    const current = await loadRequest(request.id)
    const failure = requestError(current, user.id, timestamp())
    if (failure) return failure
    const owner = await env.DB.prepare(
      `SELECT 1 FROM sites s JOIN memberships m ON m.workspace_id = s.workspace_id
       WHERE s.id = ? AND m.user_id = ? AND m.role = 'owner'`,
    ).bind(siteId, user.id).first()
    if (!owner) return forbidden()
    return Response.json({ error: { code: 'token_limit', message: 'This blog already has 10 agent keys and connections. Disconnect one before connecting another.' } }, { status: 409 })
  }
  return c.json({ redirectTo: oauthRedirect(request.redirect_uri, { code, state: request.state, iss: oauthIssuer(env.APP_URL) }) })
})

dashboardOAuthRoutes.post('/requests/:id/deny', async (c) => {
  const blocked = rejectCrossOriginBrowserPost(c.req.raw)
  if (blocked) return blocked
  const user = await sessionUser(c.req.raw)
  if (!user) return unauthorized()
  const request = await loadRequest(c.req.param('id'))
  const error = requestError(request, user.id, timestamp())
  if (error) return error
  if (!request || request.user_id !== user.id) return notFound()
  const now = timestamp()
  const result = await env.DB.prepare(
    `UPDATE oauth_authorizations SET status = 'denied', updated_at = ?
     WHERE id = ? AND status = 'pending' AND expires_at > ? AND user_id = ?`,
  ).bind(now, request.id, now, user.id).run()
  if (!result.meta.changes) {
    return requestError(await loadRequest(request.id), user.id, timestamp()) ?? expired()
  }
  return c.json({ redirectTo: oauthRedirect(request.redirect_uri, { error: 'access_denied', state: request.state, iss: oauthIssuer(env.APP_URL) }) })
})
