import { AGENT_TOKEN_PRESETS, ConflictError, DEFAULT_SCOPES, ForbiddenError, type Actor, type Scope } from '@vc/core'
import { API_TOKENS_MAX } from '@vc/config'
import { env } from 'cloudflare:workers'
import { createDataAccess, type ApiKeyAuthRecord, type ApiKeyRecord } from '@vc/db'
import { insertApiKeyWithActivity, revokeApiKeyWithActivity } from '@/server/api-key-atomic'
import type { AppUserContext } from './onboarding'

export type ApiKeyListItem = {
  id: string
  name: string
  tokenPrefix: string
  scopes: Scope[]
  actorName: string
  lastUsedAt: number | null
  revokedAt: number | null
  createdAt: number
}

const allScopes: Scope[] = [
  'sites:read',
  'posts:read',
  'posts:create',
  'posts:update',
  'posts:publish',
  'posts:archive',
  'assets:write',
  'activity:read',
]

function now() {
  return Math.floor(Date.now() / 1000)
}

export function canManageApiKeys(app: AppUserContext) {
  return app.actor.type === 'human' && app.actor.role === 'owner'
}

function requireApiKeyManager(app: AppUserContext) {
  if (!canManageApiKeys(app)) throw new ForbiddenError('Only workspace owners can manage API tokens')
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const binary = String.fromCharCode(...data)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

// HMAC-SHA-256 over the raw token using env.TOKEN_PEPPER. Stays in the app: the repo only ever
// receives the resulting hash, never the pepper or the raw token.
export async function hashApiToken(token: string, pepper = env.TOKEN_PEPPER ?? '') {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)))
}

export function apiTokenPrefix(token: string) {
  return token.slice(0, 18)
}

function randomToken(envName: 'live' | 'test' = 'live') {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `vc_${envName}_${base64Url(bytes)}`
}

function parseScopes(form: FormData) {
  const preset = form.get('preset')
  if (preset === 'full') return AGENT_TOKEN_PRESETS.full
  if (preset === 'draft') return AGENT_TOKEN_PRESETS.draft
  if (preset === 'publish') return AGENT_TOKEN_PRESETS.publish
  const requested = form
    .getAll('scopes')
    .filter((value): value is Scope => typeof value === 'string' && allScopes.includes(value as Scope))
  return requested.length > 0 ? requested : DEFAULT_SCOPES
}

// The repo returns camelCase rows; the only transformation left here is parsing scopes_json.
function mapRow(row: ApiKeyRecord): ApiKeyListItem {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: JSON.parse(row.scopesJson) as Scope[],
    actorName: row.actorName,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }
}

export { allScopes }

export async function listApiKeys(app: AppUserContext) {
  if (!canManageApiKeys(app)) return []
  const db = createDataAccess(env.DB)
  const [rows, managed] = await Promise.all([
    db.apiKeys.listActive(app.siteId),
    db.managedSites.getSnapshotBySiteId(app.siteId),
  ])
  return rows
    .filter((row) => row.id !== managed?.apiKeyId)
    .map(mapRow)
}

async function isCurrentManagedApiKey(app: AppUserContext, keyId: string) {
  const managed = await createDataAccess(env.DB).managedSites.getSnapshotBySiteId(app.siteId)
  return managed?.apiKeyId === keyId
}

export type ApiKeyMutationResult =
  | { kind: 'ok'; code: string; token: string; name: string; id: string; createdAt: number }
  | { kind: 'error'; code: string }

export async function createApiKeyForApp(
  app: AppUserContext,
  input: { name: string; actorName: string; preset: 'draft' | 'publish' | 'full' },
): Promise<ApiKeyMutationResult> {
  try {
    requireApiKeyManager(app)
    const db = createDataAccess(env.DB)
    const active = await db.apiKeys.countActive(app.siteId)
    if (active >= API_TOKENS_MAX) {
      return { kind: 'error', code: 'token_limit' }
    }
    const timestamp = now()
    const token = randomToken()
    const id = crypto.randomUUID()
    const name = input.name.trim().slice(0, 80) || 'API token'
    const actorName = input.actorName.trim().slice(0, 80) || name
    const scopes = AGENT_TOKEN_PRESETS[input.preset]
    const changes = await insertApiKeyWithActivity(
      {
        id,
        siteId: app.siteId,
        name,
        tokenPrefix: apiTokenPrefix(token),
        tokenHash: await hashApiToken(token),
        scopesJson: JSON.stringify(scopes),
        actorName,
        createdByUserId: app.user.id,
        timestamp,
      },
      app.actor,
      crypto.randomUUID(),
      API_TOKENS_MAX,
    )
    if (!changes) return { kind: 'error', code: 'token_limit' }
    return { kind: 'ok', code: 'token_created', token, name, id, createdAt: timestamp }
  } catch (error) {
    if (error instanceof ForbiddenError) return { kind: 'error', code: 'owner_required' }
    return { kind: 'error', code: 'unknown' }
  }
}

export async function revokeApiKeyForApp(
  app: AppUserContext,
  keyId: string,
): Promise<{ kind: 'ok' | 'error'; code: string }> {
  try {
    requireApiKeyManager(app)
    if (await isCurrentManagedApiKey(app, keyId)) {
      return { kind: 'error', code: 'managed_key' }
    }
    const timestamp = now()
    const changes = await revokeApiKeyWithActivity(app.siteId, keyId, timestamp, app.actor, crypto.randomUUID())
    if (!changes) return { kind: 'error', code: 'not_found' }
    return { kind: 'ok', code: 'token_revoked' }
  } catch (error) {
    if (error instanceof ForbiddenError) return { kind: 'error', code: 'owner_required' }
    return { kind: 'error', code: 'unknown' }
  }
}

export async function createApiKeyFromRequest(app: AppUserContext, request: Request) {
  requireApiKeyManager(app)
  const db = createDataAccess(env.DB)
  const active = await db.apiKeys.countActive(app.siteId)
  if (active >= API_TOKENS_MAX) throw new ConflictError('Token limit reached')
  const form = await request.formData()
  const timestamp = now()
  const token = randomToken()
  const id = crypto.randomUUID()
  const name = String(form.get('name') || 'API token')
    .trim()
    .slice(0, 80) || 'API token'
  const actorName = String(form.get('actorName') || name)
    .trim()
    .slice(0, 80) || name
  const scopes = parseScopes(form)
  const changes = await insertApiKeyWithActivity(
    {
      id,
      siteId: app.siteId,
      name,
      tokenPrefix: apiTokenPrefix(token),
      tokenHash: await hashApiToken(token),
      scopesJson: JSON.stringify(scopes),
      actorName,
      createdByUserId: app.user.id,
      timestamp,
    },
    app.actor,
    crypto.randomUUID(),
    API_TOKENS_MAX,
  )
  if (!changes) throw new ConflictError('Token limit reached')
  return { token, id, name, scopes }
}

export async function revokeApiKey(app: AppUserContext, keyId: string) {
  requireApiKeyManager(app)
  if (await isCurrentManagedApiKey(app, keyId)) {
    return new Response(null, { status: 409 })
  }
  const timestamp = now()
  const changes = await revokeApiKeyWithActivity(app.siteId, keyId, timestamp, app.actor, crypto.randomUUID())
  if (!changes) return new Response(null, { status: 404 })
  return new Response(null, { status: 303, headers: { Location: '/dashboard/settings?ok=token_revoked' } })
}

export async function authenticateBearerToken(
  request: Request,
): Promise<{ actor: Actor; siteId: string; workspaceId: string; tokenId: string } | null> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  const hash = await hashApiToken(token)
  const db = createDataAccess(env.DB)
  const row: ApiKeyAuthRecord | null = await db.apiKeys.authenticateByHash(hash)
  if (!row || row.revokedAt) return null
  await db.apiKeys.markUsed(row.id, now())
  return {
    siteId: row.siteId,
    workspaceId: row.workspaceId,
    tokenId: row.id,
    actor: {
      type: 'api_key',
      id: row.id,
      name: row.actorName,
      scopes: JSON.parse(row.scopesJson) as Scope[],
    },
  }
}
