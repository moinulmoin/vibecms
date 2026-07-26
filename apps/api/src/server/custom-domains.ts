import { env } from 'cloudflare:workers'
import {
  addCustomDomain,
  AppError,
  BillingRequiredError,
  ConflictError,
  type DomainRecord,
  type DomainRepository,
  ForbiddenError,
  listCustomDomains,
  NotFoundError,
  removeCustomDomain,
  ValidationError,
} from '@vc/core'
import { createD1DomainRepository } from '@vc/db'
import { mapCustomHostnameStatus } from '@/lib/custom-domain'
import { getBillingStatus } from '@/server/billing'
import {
  createCustomHostname,
  customHostnameCnameTarget,
  customHostnameProvisioningEnabled,
  deleteCustomHostname,
  refreshCustomHostnameStatus,
} from '@/server/custom-hostnames'
import type { AppUserContext } from '@/server/onboarding'
import { scheduleHostnamePurge } from '@/server/purge-scheduler'
import { publicBlogBaseDomain } from '@/server/public-url'

export type CustomDomainView = {
  id: string
  hostname: string
  status: DomainRecord['status']
  verificationErrors: string[]
  createdAt: number
}

export type CustomDomainsPanel = {
  domains: CustomDomainView[]
  /** The CNAME target customers point their domain at (null until Cloudflare for SaaS is configured). */
  cnameTarget: string | null
}

export type AddCustomDomainResult = { ok: true; domain: CustomDomainView } | { ok: false; code: string }
export type RemoveCustomDomainResult = { ok: true } | { ok: false; code: string }

/** Surfaced when Cloudflare create fails so the row stays retryable (no provider id). */
export const CUSTOM_HOSTNAME_PROVISIONING_ERROR =
  'Cloudflare could not provision this domain yet. Refresh Domains settings to retry.'

function appHost(): string {
  try {
    return new URL(env.APP_URL).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isOwner(app: AppUserContext): boolean {
  return app.actor.type === 'human' && app.actor.role === 'owner'
}

/** Map a domain AppError to a FORM_STATUS code the dashboard alert understands. */
function errorCode(error: AppError): string {
  if (error instanceof ValidationError) return 'domain_invalid'
  if (error instanceof ConflictError) return 'domain_conflict'
  if (error instanceof BillingRequiredError) return 'domain_billing'
  if (error instanceof ForbiddenError) return 'owner_required'
  if (error instanceof NotFoundError) return 'not_found'
  return 'unknown'
}

function toView(record: DomainRecord): CustomDomainView {
  return {
    id: record.id,
    hostname: record.hostname,
    status: record.status,
    verificationErrors: record.verificationErrorsJson ? (JSON.parse(record.verificationErrorsJson) as string[]) : [],
    createdAt: record.createdAt,
  }
}

/**
 * Create (or retry) the Cloudflare custom hostname for a domain row that has no provider id.
 * On transient failure, persists `failed` + an actionable error and returns ok:false — never a
 * misleading pending success with a null provider id.
 */
export async function ensureCustomHostnameProvisioned(
  repo: DomainRepository,
  siteId: string,
  record: DomainRecord,
): Promise<{ ok: true; domain: CustomDomainView } | { ok: false; domain: CustomDomainView }> {
  const payload = await createCustomHostname(record.hostname)
  if (payload?.id) {
    const mapped = mapCustomHostnameStatus(payload)
    await repo.setProvisioning(record.id, siteId, {
      cloudflareCustomHostnameId: payload.id,
      status: mapped.status,
      verificationErrorsJson: JSON.stringify(mapped.verificationErrors),
    })
    return {
      ok: true,
      domain: {
        id: record.id,
        hostname: record.hostname,
        status: mapped.status,
        verificationErrors: mapped.verificationErrors,
        createdAt: record.createdAt,
      },
    }
  }

  const verificationErrors = [CUSTOM_HOSTNAME_PROVISIONING_ERROR]
  await repo.setProvisioning(record.id, siteId, {
    cloudflareCustomHostnameId: null,
    status: 'failed',
    verificationErrorsJson: JSON.stringify(verificationErrors),
  })
  return {
    ok: false,
    domain: {
      id: record.id,
      hostname: record.hostname,
      status: 'failed',
      verificationErrors,
      createdAt: record.createdAt,
    },
  }
}

export async function listCustomDomainsForApp(app: AppUserContext): Promise<CustomDomainsPanel> {
  const cnameTarget = customHostnameCnameTarget()
  if (!isOwner(app)) return { domains: [], cnameTarget }
  const repo = createD1DomainRepository(env.DB)
  const rows = await listCustomDomains(repo, app.siteId)
  const provisioning = customHostnameProvisioningEnabled()

  const domains: CustomDomainView[] = []
  for (const row of rows) {
    // PROD: rows stuck without a provider id are retryable (transient create failure).
    if (provisioning && !row.cloudflareCustomHostnameId && row.status !== 'active' && row.status !== 'disabled') {
      const provisioned = await ensureCustomHostnameProvisioned(repo, app.siteId, row)
      domains.push(provisioned.domain)
      continue
    }
    // PROD: refresh the live CF status of any not-yet-active provisioned domain.
    if (provisioning && row.cloudflareCustomHostnameId && row.status !== 'active') {
      const mapped = await refreshCustomHostnameStatus(row.cloudflareCustomHostnameId)
      if (mapped && mapped.status !== row.status) {
        await repo.setProvisioning(row.id, app.siteId, {
          cloudflareCustomHostnameId: row.cloudflareCustomHostnameId,
          status: mapped.status,
          verificationErrorsJson: JSON.stringify(mapped.verificationErrors),
        })
        domains.push({
          id: row.id,
          hostname: row.hostname,
          status: mapped.status,
          verificationErrors: mapped.verificationErrors,
          createdAt: row.createdAt,
        })
        continue
      }
    }
    domains.push(toView(row))
  }
  return { domains, cnameTarget }
}

export async function addCustomDomainForApp(app: AppUserContext, hostname: string): Promise<AddCustomDomainResult> {
  try {
    const repo = createD1DomainRepository(env.DB)
    const { record, reclaimedCfHostnameId, reclaimedSiteId } = await addCustomDomain(repo, {
      siteId: app.siteId,
      hostname,
      isOwner: isOwner(app),
      isPaid: (await getBillingStatus(app.workspaceId)) === 'active',
      appHost: appHost(),
      platformZone: publicBlogBaseDomain() ?? '',
    })

    // Ownership transition: drop the prior site's cached pages for this hostname.
    if (reclaimedSiteId || reclaimedCfHostnameId) {
      if (reclaimedCfHostnameId) await deleteCustomHostname(reclaimedCfHostnameId)
      scheduleHostnamePurge(record.hostname, reclaimedSiteId)
    }

    // PROD: provision the Cloudflare custom hostname and reflect its initial status.
    if (customHostnameProvisioningEnabled()) {
      // Idempotent re-add of a row that never got a provider id also retries here.
      if (!record.cloudflareCustomHostnameId) {
        const provisioned = await ensureCustomHostnameProvisioned(repo, app.siteId, record)
        if (!provisioned.ok) return { ok: false, code: 'domain_provisioning' }
        return { ok: true, domain: provisioned.domain }
      }
    }
    return { ok: true, domain: toView(record) }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: errorCode(error) }
    throw error
  }
}

export async function removeCustomDomainForApp(app: AppUserContext, domainId: string): Promise<RemoveCustomDomainResult> {
  try {
    const repo = createD1DomainRepository(env.DB)
    // Look up before deletion (owner-scoped), so teardown/purge only run for an owner-owned row.
    let cfId: string | null = null
    let hostname: string | null = null
    if (isOwner(app)) {
      const existing = (await listCustomDomains(repo, app.siteId)).find((d) => d.id === domainId)
      cfId = existing?.cloudflareCustomHostnameId ?? null
      hostname = existing?.hostname ?? null
    }
    await removeCustomDomain(repo, { siteId: app.siteId, domainId, isOwner: isOwner(app) })
    if (cfId) await deleteCustomHostname(cfId) // best-effort, reached only when our row was actually removed
    if (hostname) scheduleHostnamePurge(hostname, app.siteId)
    return { ok: true }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: errorCode(error) }
    throw error
  }
}
