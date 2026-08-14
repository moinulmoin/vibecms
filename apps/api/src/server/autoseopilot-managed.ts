import { AGENT_TOKEN_PRESETS } from '@vc/core'
import {
  createDataAccess,
  evaluateEffectiveHostedEntitlement,
  normalizeManagedOwnerEmail,
  type ManagedSiteSnapshot,
} from '@vc/db'
import { isReservedSiteSlug } from '@vc/validators'
import { apiTokenPrefix, hashApiToken } from '@/server/api-keys'
import { scheduleManagedSitePurge } from '@/server/purge-scheduler'
import { z } from 'zod'

export const MANAGED_BODY_LIMIT = 64 * 1024

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CREDENTIAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REASON_RE = /^[\u0020-\u007e]*$/
const SECRET_IN_REASON_RE =
  /(?:token|secret|password|hash|authorization)\s*[:=]\s*\S+|vc_(?:live|test)_[A-Za-z0-9_-]{8,}/i
const UTC_EXPIRY_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/

export type ManagedInternalErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'OWNER_CONFLICT'
  | 'CREDENTIAL_CONFLICT'
  | 'STALE_GENERATION'
  | 'GENERATION_GAP'
  | 'SLUG_CONFLICT'
  | 'CONFLICT'
  | 'REQUEST_TOO_LARGE'
  | 'INTERNAL_ERROR'

export class ManagedInternalError extends Error {
  constructor(
    readonly code: ManagedInternalErrorCode,
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 413 | 500,
  ) {
    super(message)
    this.name = 'ManagedInternalError'
  }
}

function normalizeUtcDate(value: string) {
  const match = UTC_EXPIRY_RE.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction = ''] = match
  if (year === '0000') return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  const normalized = parsed.toISOString()
  const expected =
    `${year}-${month}-${day}T${hour}:${minute}:${second}.` +
    `${fraction.padEnd(3, '0')}Z`
  return normalized === expected ? normalized : null
}

const emailSchema = z.string().trim().min(3).max(254).email()
const credentialIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(CREDENTIAL_ID_RE, 'Invalid credential identity')
const generationSchema = z.number().int().positive().max(2_147_483_647)
const expiresAtSchema = z.union([
  z.null(),
  z
    .string()
    .min(1)
    .max(40)
    .transform(normalizeUtcDate)
    .refine((value): value is string => value !== null, 'Expiry must be a UTC timestamp'),
])
const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(SLUG_RE, 'Use lowercase words separated by hyphens')
  .refine((value) => !isReservedSiteSlug(value), 'That slug is reserved')

export const managedProvisionRequestSchema = z
  .object({
    ownerEmail: emailSchema,
    siteName: z.string().trim().min(1).max(120),
    siteSlug: slugSchema.optional(),
    credential: z
      .object({
        rawToken: z.string().min(1).max(145),
        credentialId: credentialIdSchema,
        generation: generationSchema,
      })
      .strict(),
    entitlement: z
      .object({
        status: z.enum(['active', 'revoked']),
        expiresAt: expiresAtSchema,
      })
      .strict(),
  })
  .strict()

export const managedRevokeRequestSchema = z
  .object({
    credentialId: credentialIdSchema,
    generation: generationSchema,
    reason: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(REASON_RE, 'Invalid reason')
      .refine((value) => !SECRET_IN_REASON_RE.test(value), 'Reason must not contain secrets')
      .optional(),
  })
  .strict()

export type ManagedProvisionRequest = z.infer<typeof managedProvisionRequestSchema>
export type ManagedRevokeRequest = z.infer<typeof managedRevokeRequestSchema>

export type ManagedReceipt = {
  externalWorkspaceId: string
  workspaceId: string
  siteId: string
  apiKeyId: string
  apiKeyPrefix: string
  publicUrl: string | null
  entitlement: {
    status: 'active' | 'revoked'
    expiresAt: string | null
    effective: boolean
  }
  lifecycle: {
    revision: number
    status: 'active' | 'revoked'
  }
  correlationId: string
}

type ManagedEnvironment = Pick<
  Cloudflare.Env,
  'DB' | 'APP_ENV' | 'SELF_HOSTED' | 'PUBLIC_BLOG_DOMAIN' | 'TOKEN_PEPPER'
>

function now() {
  return Math.floor(Date.now() / 1000)
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'site'
}

function managedSiteSlug(siteName: string, externalWorkspaceId: string) {
  const suffix = externalWorkspaceId.toLowerCase()
  const base = slugify(siteName).slice(0, Math.max(1, 80 - suffix.length - 1))
  const candidate = `${base}-${suffix}`.slice(0, 80)
  return SLUG_RE.test(candidate) && !isReservedSiteSlug(candidate) ? candidate : `site-${suffix}`
}

function defaultPublicHostname(slug: string, rawDomain: string | undefined): string | null {
  let domain = rawDomain?.trim() ?? ''
  if (domain.includes('://')) {
    try {
      domain = new URL(domain).hostname
    } catch {
      domain = ''
    }
  }
  domain = domain.toLowerCase().replace(/\.$/, '')
  return domain ? `${slug}.${domain}` : null
}

function publicUrlForHostname(hostname: string | null) {
  if (!hostname) return null
  const local =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.0.0.1:')
  return `${local ? 'http' : 'https'}://${hostname}`
}

function expirySeconds(value: string | null) {
  if (value === null) return null
  return Math.floor(Date.parse(value) / 1000)
}

function expiryIso(value: number | null) {
  return value === null ? null : new Date(value * 1000).toISOString()
}

function assertTokenFormat(rawToken: string, appEnv: string) {
  const prefix = appEnv === 'production' ? 'vc_live_' : 'vc_test_'
  const tokenPattern = new RegExp(`^${prefix}[A-Za-z0-9_-]{32,128}$`)
  if (!tokenPattern.test(rawToken)) {
    throw new ManagedInternalError(
      'VALIDATION_ERROR',
      'Invalid credential token',
      400,
    )
  }
}

function canonicalExternalWorkspaceId(externalWorkspaceId: string) {
  if (!UUID_RE.test(externalWorkspaceId)) {
    throw new ManagedInternalError('VALIDATION_ERROR', 'Invalid external workspace ID', 400)
  }
  return externalWorkspaceId.toLowerCase()
}

function errorCauseMessages(error: unknown) {
  const messages: string[] = []
  const seen = new Set<object>()
  let current: unknown = error
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === 'object') {
      if (seen.has(current)) break
      seen.add(current)
    }
    if (current instanceof Error) {
      messages.push(current.message)
      current = current.cause
      continue
    }
    if (typeof current === 'object' && 'message' in current) {
      const message = (current as { message?: unknown }).message
      if (typeof message === 'string') messages.push(message)
      current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined
      continue
    }
    break
  }
  return messages
}

function isSiteSlugUniqueError(error: unknown) {
  return errorCauseMessages(error).some((message) =>
    /unique constraint failed[^]*\bsites\.slug\b/i.test(message),
  )
}

function isApiKeyHashUniqueError(error: unknown) {
  return errorCauseMessages(error).some((message) =>
    /unique constraint failed[^]*\bapi_keys\.token_hash\b/i.test(message),
  )
}

function mapRepositoryError(error: unknown): ManagedInternalError | null {
  if (!(error instanceof Error)) return null
  switch (error.message) {
    case 'managed_owner_conflict':
      return new ManagedInternalError('OWNER_CONFLICT', 'The managed site owner does not match.', 409)
    case 'managed_credential_conflict':
      return new ManagedInternalError('CREDENTIAL_CONFLICT', 'The managed credential does not match.', 409)
    case 'managed_stale_generation':
    case 'managed_replay_revoked':
      return new ManagedInternalError('STALE_GENERATION', 'The credential generation is stale.', 409)
    case 'managed_site_slug_conflict':
      return new ManagedInternalError('SLUG_CONFLICT', 'The requested site slug is already in use.', 409)
    case 'managed_credential_generation_invalid':
    case 'managed_owner_email_required':
    case 'managed_site_slug_required':
      return new ManagedInternalError('VALIDATION_ERROR', 'Invalid managed site request.', 400)
    default:
      return null
  }
}

function conflict(code: ManagedInternalErrorCode, message: string) {
  return new ManagedInternalError(code, message, 409)
}

function classifyGeneration(current: ManagedSiteSnapshot, requested: number) {
  if (requested < current.credentialGeneration) {
    throw conflict('STALE_GENERATION', 'The credential generation is stale.')
  }
  if (requested > current.credentialGeneration + 1) {
    throw conflict('GENERATION_GAP', 'The credential generation must be the next generation.')
  }
}

function assertOwnerAndCredential(
  current: ManagedSiteSnapshot,
  input: { ownerEmail?: string; credentialId: string; siteSlug?: string },
) {
  if (input.ownerEmail !== undefined && current.ownerEmail !== normalizeManagedOwnerEmail(input.ownerEmail)) {
    throw conflict('OWNER_CONFLICT', 'The managed site owner does not match.')
  }
  if (current.credentialId !== input.credentialId) {
    throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
  }
  if (input.siteSlug !== undefined && current.siteSlug !== input.siteSlug) {
    throw conflict('SLUG_CONFLICT', 'The managed site slug is immutable.')
  }
}

async function publicUrl(
  environment: ManagedEnvironment,
  snapshot: ManagedSiteSnapshot,
  db: ReturnType<typeof createDataAccess>,
  repairLocalHostname: boolean,
) {
  let hostname = await db.sites.getActiveDefaultHostname(snapshot.siteId)
  if (
    hostname &&
    (hostname === 'localhost' || hostname.endsWith('.localhost')) &&
    environment.PUBLIC_BLOG_DOMAIN
  ) {
    const repairedHostname = defaultPublicHostname(snapshot.siteSlug, environment.PUBLIC_BLOG_DOMAIN)
    if (repairedHostname) {
      hostname = repairLocalHostname
        ? await db.sites.repairDefaultHostname({
            siteId: snapshot.siteId,
            currentHostname: hostname,
            newHostname: repairedHostname,
          })
        : repairedHostname
    }
  }
  return publicUrlForHostname(hostname)
}

async function resolveReceipt(
  environment: ManagedEnvironment,
  snapshot: ManagedSiteSnapshot,
  correlationId: string,
  options: { repairLocalHostname?: boolean } = {},
): Promise<ManagedReceipt> {
  const db = createDataAccess(environment.DB)
  const entitlement =
    (await db.managedSites.resolveSite(snapshot.siteId, {
      selfHosted: String(environment.SELF_HOSTED) === 'true',
      now: now(),
    })) ??
    evaluateEffectiveHostedEntitlement(
      {
        selfHosted: String(environment.SELF_HOSTED) === 'true',
        polar: {
          status: snapshot.polarStatus,
          currentPeriodEnd: snapshot.polarCurrentPeriodEnd,
        },
        managedSponsorship: {
          status: snapshot.entitlementStatus,
          expiresAt: snapshot.entitlementExpiresAt,
        },
      },
      now(),
    )
  const resolvedPublicUrl = await publicUrl(
    environment,
    snapshot,
    db,
    options.repairLocalHostname ?? true,
  )
  if (snapshot.entitlementStatus === 'active' && !resolvedPublicUrl) {
    throw new ManagedInternalError('INTERNAL_ERROR', 'Managed public URL is unavailable.', 500)
  }
  return {
    externalWorkspaceId: snapshot.externalWorkspaceId,
    workspaceId: snapshot.workspaceId,
    siteId: snapshot.siteId,
    apiKeyId: snapshot.apiKeyId,
    apiKeyPrefix: snapshot.apiKeyPrefix,
    publicUrl: resolvedPublicUrl,
    entitlement: {
      status: snapshot.entitlementStatus,
      expiresAt: expiryIso(snapshot.entitlementExpiresAt),
      effective: entitlement.effective,
    },
    lifecycle: {
      revision: snapshot.lifecycleRevision,
      status: snapshot.entitlementStatus,
    },
    correlationId,
  }
}

async function managedMutationResult(
  environment: ManagedEnvironment,
  snapshot: ManagedSiteSnapshot,
  correlationId: string,
  status: 200 | 201,
) {
  scheduleManagedSitePurge(
    environment.DB,
    snapshot.siteId,
    snapshot.siteSlug,
  )
  const receipt = await resolveReceipt(environment, snapshot, correlationId)
  return { status, receipt }
}

function newProvisionIds(externalWorkspaceId: string, generation: number) {
  return {
    ownerId: `user_autoseopilot_${externalWorkspaceId}`,
    workspaceId: `workspace_autoseopilot_${externalWorkspaceId}`,
    workspaceSlug: `autoseopilot-${externalWorkspaceId}`,
    membershipId: `membership_autoseopilot_${externalWorkspaceId}`,
    siteId: `site_autoseopilot_${externalWorkspaceId}`,
    bindingId: `binding_autoseopilot_${externalWorkspaceId}`,
    apiKeyId: `key_autoseopilot_${externalWorkspaceId}_${generation}`,
    domainId: `domain_autoseopilot_${externalWorkspaceId}`,
  }
}

function apiKeyInput(
  request: ManagedProvisionRequest,
  tokenHash: string,
  apiKeyId: string,
) {
  return {
    id: apiKeyId,
    name: 'AutoSEOPilot',
    tokenPrefix: apiTokenPrefix(request.credential.rawToken),
    tokenHash,
    scopesJson: JSON.stringify(AGENT_TOKEN_PRESETS.full),
    actorName: 'AutoSEOPilot',
  }
}

function exactRotationSnapshot(
  snapshot: ManagedSiteSnapshot,
  request: ManagedProvisionRequest,
  tokenHash: string,
  expiresAt: number | null,
) {
  return (
    snapshot.credentialId === request.credential.credentialId &&
    snapshot.credentialGeneration === request.credential.generation &&
    snapshot.apiKeyId === newProvisionIds(snapshot.externalWorkspaceId, request.credential.generation).apiKeyId &&
    snapshot.apiKeyHash === tokenHash &&
    snapshot.entitlementStatus === 'active' &&
    snapshot.entitlementExpiresAt === expiresAt
  )
}

function classifyRotationSnapshot(
  snapshot: ManagedSiteSnapshot | null,
  current: ManagedSiteSnapshot,
  request: ManagedProvisionRequest,
  tokenHash: string,
  expiresAt: number | null,
) {
  if (snapshot) {
    assertOwnerAndCredential(snapshot, {
      ownerEmail: request.ownerEmail,
      credentialId: request.credential.credentialId,
      siteSlug: request.siteSlug,
    })
    if (exactRotationSnapshot(snapshot, request, tokenHash, expiresAt)) {
      return snapshot
    }
    if (snapshot.credentialGeneration > request.credential.generation) {
      throw conflict('STALE_GENERATION', 'The credential generation is stale.')
    }
    if (snapshot.credentialGeneration + 1 < request.credential.generation) {
      throw conflict('GENERATION_GAP', 'The credential generation must be the next generation.')
    }
    if (snapshot.credentialGeneration === request.credential.generation) {
      throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
    }
    if (snapshot.entitlementStatus === 'revoked') {
      throw conflict('STALE_GENERATION', 'The credential generation is stale.')
    }
  }
  if (current.credentialGeneration >= request.credential.generation) {
    throw conflict('STALE_GENERATION', 'The credential generation is stale.')
  }
  throw conflict('STALE_GENERATION', 'The managed site changed before rotation completed.')
}

async function rotateManagedCredential(
  db: ReturnType<typeof createDataAccess>,
  externalWorkspaceId: string,
  request: ManagedProvisionRequest,
  tokenHash: string,
  expiresAt: number | null,
  current: ManagedSiteSnapshot,
  timestamp: number,
  correlationId: string,
) {
  const input = {
    externalWorkspaceId,
    credentialId: request.credential.credentialId,
    currentGeneration: current.credentialGeneration,
    newGeneration: request.credential.generation,
    expectedLifecycleRevision: current.lifecycleRevision,
    newApiKey: apiKeyInput(
      request,
      tokenHash,
      newProvisionIds(externalWorkspaceId, request.credential.generation).apiKeyId,
    ),
    entitlementExpiresAt: expiresAt,
    timestamp,
    activity: { requestId: correlationId },
  }
  try {
    const result = await db.managedSites.rotateOrReactivate(input)
    if (result.snapshot && (result.applied || exactRotationSnapshot(result.snapshot, request, tokenHash, expiresAt))) {
      return { snapshot: result.snapshot }
    }
    if (
      result.snapshot &&
      result.snapshot.credentialGeneration === request.credential.generation &&
      result.snapshot.apiKeyHash === tokenHash &&
      result.snapshot.entitlementStatus === 'active'
    ) {
      return {
        snapshot: await reconcileManagedEntitlement(
          db,
          externalWorkspaceId,
          request.credential.credentialId,
          result.snapshot,
          expiresAt,
          timestamp,
          correlationId,
        ),
      }
    }
    return {
      snapshot: classifyRotationSnapshot(
        result.snapshot,
        current,
        request,
        tokenHash,
        expiresAt,
      ),
    }
  } catch (error) {
    const snapshot = await db.managedSites.getSnapshotByExternalWorkspaceId(externalWorkspaceId)
    if (isApiKeyHashUniqueError(error)) {
      throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
    }
    if (isSiteSlugUniqueError(error)) {
      throw conflict('SLUG_CONFLICT', 'The requested site slug is already in use.')
    }
    return {
      snapshot: classifyRotationSnapshot(snapshot, current, request, tokenHash, expiresAt),
    }
  }
}

async function reconcileManagedEntitlement(
  db: ReturnType<typeof createDataAccess>,
  externalWorkspaceId: string,
  credentialId: string,
  current: ManagedSiteSnapshot,
  expiresAt: number | null,
  timestamp: number,
  correlationId: string,
): Promise<ManagedSiteSnapshot> {
  const input = {
    externalWorkspaceId,
    credentialId,
    credentialGeneration: current.credentialGeneration,
    expectedLifecycleRevision: current.lifecycleRevision,
    entitlementStatus: 'active' as const,
    entitlementExpiresAt: expiresAt,
    timestamp,
    activity: { requestId: correlationId },
  }
  const matches = (snapshot: ManagedSiteSnapshot | null) =>
    snapshot !== null &&
    snapshot.credentialId === credentialId &&
    snapshot.credentialGeneration === current.credentialGeneration &&
    snapshot.entitlementStatus === 'active' &&
    snapshot.entitlementExpiresAt === expiresAt
  try {
    const result = await db.managedSites.reconcile(input)
    if (result.snapshot && matches(result.snapshot)) return result.snapshot
    const snapshot = result.snapshot ?? (await db.managedSites.getSnapshotByExternalWorkspaceId(externalWorkspaceId))
    if (snapshot && matches(snapshot)) return snapshot
    if (!snapshot || snapshot.credentialGeneration > current.credentialGeneration) {
      throw conflict('STALE_GENERATION', 'The credential generation is stale.')
    }
    if (snapshot.credentialId !== credentialId) {
      throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
    }
    throw conflict('STALE_GENERATION', 'The managed site changed before reconciliation completed.')
  } catch (error) {
    if (error instanceof ManagedInternalError) throw error
    const snapshot = await db.managedSites.getSnapshotByExternalWorkspaceId(externalWorkspaceId)
    if (snapshot && matches(snapshot)) return snapshot
    if (!snapshot || snapshot.credentialGeneration > current.credentialGeneration) {
      throw conflict('STALE_GENERATION', 'The credential generation is stale.')
    }
    if (snapshot.credentialId !== credentialId) {
      throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
    }
    throw conflict('STALE_GENERATION', 'The managed site changed before reconciliation completed.')
  }
}

async function readExisting(
  environment: ManagedEnvironment,
  externalWorkspaceId: string,
) {
  return createDataAccess(environment.DB).managedSites.getSnapshotByExternalWorkspaceId(externalWorkspaceId)
}

export async function getManagedSite(
  environment: ManagedEnvironment,
  externalWorkspaceId: string,
  correlationId: string,
) {
  externalWorkspaceId = canonicalExternalWorkspaceId(externalWorkspaceId)
  const snapshot = await readExisting(environment, externalWorkspaceId)
  if (!snapshot) throw new ManagedInternalError('NOT_FOUND', 'Managed site not found.', 404)
  return resolveReceipt(environment, snapshot, correlationId, {
    repairLocalHostname: false,
  })
}

export async function provisionManagedSite(
  environment: ManagedEnvironment,
  externalWorkspaceId: string,
  request: ManagedProvisionRequest,
  correlationId: string,
) {
  externalWorkspaceId = canonicalExternalWorkspaceId(externalWorkspaceId)
  if (!environment.TOKEN_PEPPER) {
    throw new ManagedInternalError('INTERNAL_ERROR', 'Request failed.', 500)
  }
  assertTokenFormat(request.credential.rawToken, String(environment.APP_ENV))
  const timestamp = now()
  const tokenHash = await hashApiToken(request.credential.rawToken, environment.TOKEN_PEPPER)
  const db = createDataAccess(environment.DB)
  const current = await db.managedSites.getSnapshotByExternalWorkspaceId(externalWorkspaceId)

  if (!current) {
    if (request.entitlement.status !== 'active') {
      throw conflict('CONFLICT', 'A managed site must be provisioned with active entitlement.')
    }
    const siteSlug = request.siteSlug ?? managedSiteSlug(request.siteName, externalWorkspaceId)
    const slugOwner = await db.sites.getSiteBySlug(siteSlug)
    if (slugOwner) {
      throw conflict('SLUG_CONFLICT', 'The requested site slug is already in use.')
    }
    const publicHostname = defaultPublicHostname(siteSlug, environment.PUBLIC_BLOG_DOMAIN)
    if (!publicHostname) {
      throw new ManagedInternalError('INTERNAL_ERROR', 'Managed public URL is unavailable.', 500)
    }
    const ids = newProvisionIds(externalWorkspaceId, request.credential.generation)
    const snapshotInput = {
      timestamp,
      owner: {
        id: ids.ownerId,
        name: request.ownerEmail.split('@')[0] || 'AutoSEOPilot owner',
        email: normalizeManagedOwnerEmail(request.ownerEmail),
      },
      workspace: {
        id: ids.workspaceId,
        name: `${request.siteName} Workspace`.slice(0, 120),
        slug: ids.workspaceSlug,
      },
      membership: { id: ids.membershipId },
      site: {
        id: ids.siteId,
        name: request.siteName,
        slug: siteSlug,
        description: null,
      },
      siteSlugProvided: request.siteSlug !== undefined,
      defaultDomain: {
        id: ids.domainId,
        hostname: publicHostname,
      },
      apiKey: apiKeyInput(request, tokenHash, ids.apiKeyId),
      binding: {
        id: ids.bindingId,
        externalWorkspaceId,
        credentialId: request.credential.credentialId,
        credentialGeneration: request.credential.generation,
        entitlementStatus: 'active' as const,
        entitlementExpiresAt: expirySeconds(request.entitlement.expiresAt),
        lifecycleRevision: 1,
      },
      activity: { requestId: correlationId },
    }
    let snapshot: ManagedSiteSnapshot
    try {
      const provisioned = await db.managedSites.firstProvisionWithOutcome(snapshotInput)
      snapshot = provisioned.snapshot
      if (!provisioned.created) {
        assertOwnerAndCredential(snapshot, {
          ownerEmail: request.ownerEmail,
          credentialId: request.credential.credentialId,
          siteSlug: request.siteSlug,
        })
        if (
          snapshot.credentialGeneration !== request.credential.generation ||
          snapshot.apiKeyHash !== tokenHash ||
          snapshot.entitlementStatus !== request.entitlement.status
        ) {
          throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
        }
        if (snapshot.entitlementExpiresAt !== expirySeconds(request.entitlement.expiresAt)) {
          snapshot = await reconcileManagedEntitlement(
            db,
            externalWorkspaceId,
            request.credential.credentialId,
            snapshot,
            expirySeconds(request.entitlement.expiresAt),
            timestamp,
            correlationId,
          )
        }
        return managedMutationResult(environment, snapshot, correlationId, 200)
      }
    } catch (error) {
      if (error instanceof ManagedInternalError) throw error
      if (isApiKeyHashUniqueError(error)) {
        throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
      }
      if (isSiteSlugUniqueError(error)) {
        throw conflict('SLUG_CONFLICT', 'The requested site slug is already in use.')
      }
      const known = mapRepositoryError(error)
      if (known) throw known
      const winner = await db.managedSites.getSnapshotByExternalWorkspaceId(externalWorkspaceId)
      if (winner) {
        assertOwnerAndCredential(winner, {
          ownerEmail: request.ownerEmail,
          credentialId: request.credential.credentialId,
          siteSlug: request.siteSlug,
        })
        if (
          winner.credentialGeneration === request.credential.generation &&
          winner.apiKeyHash === tokenHash &&
          winner.entitlementStatus === 'active'
        ) {
          const recovered =
            winner.entitlementExpiresAt === expirySeconds(request.entitlement.expiresAt)
              ? winner
              : await reconcileManagedEntitlement(
                  db,
                  externalWorkspaceId,
                  request.credential.credentialId,
                  winner,
                  expirySeconds(request.entitlement.expiresAt),
                  timestamp,
                  correlationId,
                )
          return managedMutationResult(environment, recovered, correlationId, 200)
        }
      }
      throw new ManagedInternalError('INTERNAL_ERROR', 'Request failed.', 500)
    }
    return managedMutationResult(environment, snapshot, correlationId, 201)
  }

  assertOwnerAndCredential(current, {
    ownerEmail: request.ownerEmail,
    credentialId: request.credential.credentialId,
    siteSlug: request.siteSlug,
  })

  const requestedExpiry = expirySeconds(request.entitlement.expiresAt)
  const currentIsRevoked =
    current.entitlementStatus === 'revoked' ||
    current.revokedAt !== null ||
    current.apiKeyRevokedAt !== null

  if (request.entitlement.status === 'revoked') {
    if (currentIsRevoked) {
      if (request.credential.generation !== current.credentialGeneration) {
        throw conflict('STALE_GENERATION', 'The credential generation is stale.')
      }
      if (current.apiKeyHash !== tokenHash) {
        throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
      }
      return managedMutationResult(environment, current, correlationId, 200)
    }
    throw conflict('CONFLICT', 'Use revoke to revoke an active managed site.')
  }

  if (currentIsRevoked) {
    classifyGeneration(current, request.credential.generation)
    if (request.credential.generation !== current.credentialGeneration + 1) {
      throw conflict('STALE_GENERATION', 'The credential generation is stale.')
    }
    if (current.apiKeyHash === tokenHash) {
      throw conflict('CREDENTIAL_CONFLICT', 'A new generation requires a new credential.')
    }
    const rotated = await rotateManagedCredential(
      db,
      externalWorkspaceId,
      request,
      tokenHash,
      requestedExpiry,
      current,
      timestamp,
      correlationId,
    )
    return managedMutationResult(environment, rotated.snapshot, correlationId, 200)
  }

  classifyGeneration(current, request.credential.generation)
  if (request.credential.generation === current.credentialGeneration) {
    if (current.apiKeyHash !== tokenHash) {
      throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
    }
    if (current.entitlementExpiresAt === requestedExpiry) {
      return managedMutationResult(environment, current, correlationId, 200)
    }
    const reconciled = await reconcileManagedEntitlement(
      db,
      externalWorkspaceId,
      request.credential.credentialId,
      current,
      requestedExpiry,
      timestamp,
      correlationId,
    )
    return managedMutationResult(environment, reconciled, correlationId, 200)
  }

  if (current.apiKeyHash === tokenHash) {
    throw conflict('CREDENTIAL_CONFLICT', 'A new generation requires a new credential.')
  }
  const rotated = await rotateManagedCredential(
    db,
    externalWorkspaceId,
    request,
    tokenHash,
    requestedExpiry,
    current,
    timestamp,
    correlationId,
  )
  return managedMutationResult(environment, rotated.snapshot, correlationId, 200)
}

export async function revokeManagedSite(
  environment: ManagedEnvironment,
  externalWorkspaceId: string,
  request: ManagedRevokeRequest,
  correlationId: string,
) {
  externalWorkspaceId = canonicalExternalWorkspaceId(externalWorkspaceId)
  const db = createDataAccess(environment.DB)
  const current = await db.managedSites.getSnapshotByExternalWorkspaceId(externalWorkspaceId)
  if (!current) throw new ManagedInternalError('NOT_FOUND', 'Managed site not found.', 404)
  if (current.credentialId !== request.credentialId) {
    throw conflict('CREDENTIAL_CONFLICT', 'The managed credential does not match.')
  }
  if (request.generation < current.credentialGeneration) {
    throw conflict('STALE_GENERATION', 'The credential generation is stale.')
  }
  if (request.generation > current.credentialGeneration) {
    throw conflict('STALE_GENERATION', 'The credential generation is stale.')
  }
  if (current.entitlementStatus === 'revoked' || current.revokedAt !== null) {
    return managedMutationResult(environment, current, correlationId, 200)
  }
  const revoked = await db.managedSites.revoke({
    externalWorkspaceId,
    credentialId: request.credentialId,
    credentialGeneration: request.generation,
    expectedLifecycleRevision: current.lifecycleRevision,
    timestamp: now(),
    reason: request.reason ?? null,
    activity: { requestId: correlationId },
  })
  if (!revoked.snapshot) {
    throw new ManagedInternalError('INTERNAL_ERROR', 'Request failed.', 500)
  }
  if (!revoked.applied) {
    if (
      revoked.snapshot.entitlementStatus === 'revoked' &&
      revoked.snapshot.credentialId === request.credentialId &&
      revoked.snapshot.credentialGeneration === request.generation
    ) {
      return managedMutationResult(environment, revoked.snapshot, correlationId, 200)
    }
    throw conflict('STALE_GENERATION', 'The managed site changed before revoke completed.')
  }
  return managedMutationResult(environment, revoked.snapshot, correlationId, 200)
}
