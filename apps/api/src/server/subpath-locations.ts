import { env } from 'cloudflare:workers'
import {
  AppError,
  BillingRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  subpathProxyTarget,
  subpathSnippets,
  validateSubpathLocation,
  type Actor,
  type DomainRecord,
  type SubpathSnippets,
  can,
} from '@vc/core'
import { createDataAccess, type DataAccess } from '@vc/db'
import { resolveEffectiveEntitlementForWorkspace } from '@/server/effective-entitlement'
import type { AppUserContext } from '@/server/onboarding'
import { scheduleSitePurge } from '@/server/purge-scheduler'
import { appHost, publicBlogBaseDomain } from '@/server/public-url'
import { checkSubpathSetup, type SubpathCheckResult } from '@/server/subpath-setup'
import { defaultHostBaseUrl } from '@/server/site-public-url'

/**
 * The site's public location (plans/022 phase 3): default host, custom domain,
 * or a path of the customer's own site. Owner-gated like custom domains; the
 * proxy target and snippets leave the app only for actors who could rotate
 * the credential anyway (owner, or a key holding site:write).
 */

export type SubpathLocationStatus = 'pending' | 'active' | 'failed' | 'disabled'

export type SubpathLocationView = {
  type: 'default' | 'custom' | 'subpath'
  url: string | null
  status: SubpathLocationStatus | null
  proxyTarget?: string
  snippets?: SubpathSnippets
  lastCheck?: { ok: boolean; checkedAt: number; errors: { code: string; message: string }[]; warnings: { code: string; message: string }[] }
}

export type LocationResult = { ok: true; location: SubpathLocationView } | { ok: false; code: string }

const ROTATE_WARNING =
  'The proxy link changed — the old link stops working at once. Update your proxy config with the new snippet.'

function errorCode(error: AppError): string {
  if (error instanceof ForbiddenError) return 'owner_required'
  if (error instanceof BillingRequiredError) return 'billing_required'
  if (error instanceof ConflictError) return 'domain_conflict'
  if (error instanceof NotFoundError) return 'not_found'
  return 'domain_invalid'
}

function isOwner(actor: Actor): boolean {
  return actor.type === 'human' && actor.role === 'owner'
}

// Setup details (proxy target + snippets embed the proxy id credential) are
// owner-only: a key with site:write could rotate the id anyway, so it may
// also see them. Read-scoped keys get the public status view only.
function canSeeSetup(actor: Actor): boolean {
  return isOwner(actor) || can(actor, 'site:write')
}

function parseLastCheck(record: DomainRecord): SubpathLocationView['lastCheck'] {
  if (!record.verificationErrorsJson) return undefined
  try {
    const parsed = JSON.parse(record.verificationErrorsJson) as Partial<SubpathCheckResult & { checkedAt: number }>
    if (typeof parsed.checkedAt !== 'number') return undefined
    return {
      ok: parsed.ok === true,
      checkedAt: parsed.checkedAt,
      errors: Array.isArray(parsed.errors) ? (parsed.errors as { code: string; message: string }[]) : [],
      warnings: Array.isArray(parsed.warnings) ? (parsed.warnings as { code: string; message: string }[]) : [],
    }
  } catch {
    return undefined
  }
}

function subpathView(record: DomainRecord, slug: string, withSetup: boolean): SubpathLocationView {
  const url = `https://${record.hostname}${record.basePath ?? ''}`
  const domain = publicBlogBaseDomain()
  if (!withSetup || !domain || !record.proxyId) {
    return { type: 'subpath', url, status: record.status, lastCheck: parseLastCheck(record) }
  }
  const proxyTarget = subpathProxyTarget({ slug, publicBlogDomain: domain, proxyId: record.proxyId })
  return {
    type: 'subpath',
    url,
    status: record.status,
    proxyTarget,
    snippets: subpathSnippets({ hostname: record.hostname, basePath: record.basePath ?? '', proxyTarget }),
    lastCheck: parseLastCheck(record),
  }
}

/** The view a requester sees: subpath (any status) > configured custom > default host. */
export async function getSiteLocation(
  data: DataAccess,
  siteId: string,
  slug: string,
  actor: Actor,
): Promise<SubpathLocationView> {
  const rows = await data.domains.listBySite(siteId)
  const subpath = rows.find((row) => row.type === 'subpath')
  if (subpath) return subpathView(subpath, slug, canSeeSetup(actor))
  const custom = rows.find((row) => row.type === 'custom' && row.status === 'active') ?? rows.find((row) => row.type === 'custom')
  if (custom) {
    return { type: 'custom', url: `https://${custom.hostname}`, status: custom.status }
  }
  const url = await defaultHostBaseUrl(data, siteId, slug)
  return { type: 'default', url, status: url ? 'active' : null }
}

// Owner-only for humans, site:write for keys (MCP exposes these operations).
async function assertAuthorized(actor: Actor): Promise<void> {
  if (!isOwner(actor) && !can(actor, 'site:write')) {
    throw new ForbiddenError('Only workspace owners can manage the blog location.')
  }
}

// Subpath hosting is a paid entitlement on hosted vibecms; self-host is free.
// Only SETTING a location gates on it — removal stays authorization-only so an
// expired subscription can still disconnect (and release) the hostname.
async function assertCanWrite(actor: Actor, workspaceId: string): Promise<void> {
  await assertAuthorized(actor)
  const entitlement = await resolveEffectiveEntitlementForWorkspace(workspaceId)
  if (!entitlement.effective) {
    throw new BillingRequiredError('Hosting the blog on your site requires an active subscription.')
  }
}

async function requireSubpathRow(data: DataAccess, siteId: string): Promise<DomainRecord> {
  const row = (await data.domains.listBySite(siteId)).find((domain) => domain.type === 'subpath')
  if (!row) throw new NotFoundError('No subpath location is set up for this blog.')
  return row
}

function purgeAfterChange(siteId: string, slug: string, hostname: string | null, basePath: string | null) {
  scheduleSitePurge(siteId, slug, [], hostname ? [{ hostname, basePath: basePath ?? '' }] : [])
}

export async function getSiteLocationForApp(app: AppUserContext): Promise<SubpathLocationView | null> {
  const data = createDataAccess(env.DB)
  const slug = await data.sites.getSiteSlug(app.siteId)
  if (!slug) return null
  return getSiteLocation(data, app.siteId, slug, app.actor)
}

export async function setSubpathLocationForApp(app: AppUserContext, url: string): Promise<LocationResult> {
  try {
    await assertCanWrite(app.actor, app.workspaceId)
    const validation = validateSubpathLocation(url, { appHost: appHost(), platformZone: publicBlogBaseDomain() ?? '' })
    if (!validation.ok) {
      return { ok: false, code: 'location_invalid' }
    }
    const data = createDataAccess(env.DB)
    const slug = await data.sites.getSiteSlug(app.siteId)
    if (!slug) throw new NotFoundError('Site not found')
    const record = await data.domains.insertSubpath({
      siteId: app.siteId,
      hostname: validation.hostname,
      basePath: validation.basePath,
    })
    return { ok: true, location: subpathView(record, slug, true) }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: errorCode(error) }
    throw error
  }
}

export type CheckLocationResult =
  | { ok: true; check: SubpathCheckResult; location: SubpathLocationView }
  | { ok: false; code: string }

/** The owner-facing manual check: promotes pending->active on pass, records failures otherwise. */
export async function checkSubpathLocationForApp(app: AppUserContext): Promise<CheckLocationResult> {
  try {
    await assertCanWrite(app.actor, app.workspaceId)
    const data = createDataAccess(env.DB)
    const slug = await data.sites.getSiteSlug(app.siteId)
    if (!slug) throw new NotFoundError('Site not found')
    const row = await requireSubpathRow(data, app.siteId)
    const check = await checkSubpathSetup(row, { id: app.siteId })
    // Conditional write: applies only if the row still carries the proxy id we
    // checked (a rotate/remove mid-probe makes it a no-op), and a failing check
    // can never demote a row that is already active.
    const applied = await data.domains.recordSubpathCheck(row.id, app.siteId, {
      proxyId: row.proxyId ?? '',
      checkPassed: check.ok,
      verificationErrorsJson: JSON.stringify(check),
    })
    if (!applied) {
      throw new ConflictError('The proxy link changed while the check ran. Run the check again.')
    }
    if (check.ok && row.status !== 'active') {
      purgeAfterChange(app.siteId, slug, row.hostname, row.basePath)
      await data.activity.create({
        siteId: app.siteId,
        actor: app.actor,
        action: 'site.location.verified',
        entityType: 'site',
        entityId: app.siteId,
        summary: `Verified the blog location at ${row.hostname}${row.basePath ?? ''}.`,
      })
    }
    // Re-read so the returned view carries the check just recorded.
    const updated = await requireSubpathRow(data, app.siteId)
    return { ok: true, check, location: subpathView(updated, slug, true) }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: errorCode(error) }
    throw error
  }
}

export type RotateLocationResult =
  | { ok: true; location: SubpathLocationView; warning: string }
  | { ok: false; code: string }

/** New proxy id. Dashboard only — rotating breaks the customer's snippet instantly. */
export async function rotateSubpathProxyLinkForApp(app: AppUserContext): Promise<RotateLocationResult> {
  try {
    await assertCanWrite(app.actor, app.workspaceId)
    const data = createDataAccess(env.DB)
    const slug = await data.sites.getSiteSlug(app.siteId)
    if (!slug) throw new NotFoundError('Site not found')
    const row = await requireSubpathRow(data, app.siteId)
    const proxyId = await data.domains.rotateProxyId(row.id, app.siteId)
    const status = row.status === 'active' ? 'active' : 'pending'
    if (status !== row.status) await data.domains.setSubpathStatus(row.id, app.siteId, status)
    return { ok: true, location: subpathView({ ...row, proxyId, status }, slug, true), warning: ROTATE_WARNING }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: errorCode(error) }
    throw error
  }
}

export async function removeSubpathLocationForApp(app: AppUserContext): Promise<LocationResult> {
  try {
    await assertAuthorized(app.actor)
    const data = createDataAccess(env.DB)
    const slug = await data.sites.getSiteSlug(app.siteId)
    if (!slug) throw new NotFoundError('Site not found')
    const row = (await data.domains.listBySite(app.siteId)).find((domain) => domain.type === 'subpath')
    if (row) {
      await data.domains.deleteSubpathForSite(app.siteId)
      purgeAfterChange(app.siteId, slug, row.hostname, row.basePath)
    }
    return { ok: true, location: await getSiteLocation(data, app.siteId, slug, app.actor) }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: errorCode(error) }
    throw error
  }
}
