import { env } from 'cloudflare:workers'
import { addCustomDomain, AppError, type DomainRecord, listCustomDomains, removeCustomDomain } from '@vc/core'
import { createD1DomainRepository } from '@vc/db'
import { mapCustomHostnameStatus } from '~/lib/custom-domain'
import { getBillingStatus } from '~/server/billing'
import {
  createCustomHostname,
  customHostnameCnameTarget,
  customHostnameProvisioningEnabled,
  deleteCustomHostname,
  refreshCustomHostnameStatus,
} from '~/server/custom-hostnames'
import type { AppUserContext } from '~/server/onboarding'
import { publicBlogBaseDomain } from '~/server/onboarding'

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

export type AddCustomDomainResult = { ok: true; domain: CustomDomainView } | { ok: false; error: string }
export type RemoveCustomDomainResult = { ok: true } | { ok: false; error: string }

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

function toView(record: DomainRecord): CustomDomainView {
  return {
    id: record.id,
    hostname: record.hostname,
    status: record.status,
    verificationErrors: record.verificationErrorsJson ? (JSON.parse(record.verificationErrorsJson) as string[]) : [],
    createdAt: record.createdAt,
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
    // PROD: refresh the live CF status of any not-yet-active provisioned domain.
    if (provisioning && row.cloudflareCustomHostnameId && row.status !== 'active') {
      const mapped = await refreshCustomHostnameStatus(row.cloudflareCustomHostnameId)
      if (mapped && mapped.status !== row.status) {
        await repo.setProvisioning(row.id, app.siteId, {
          cloudflareCustomHostnameId: row.cloudflareCustomHostnameId,
          status: mapped.status,
          verificationErrorsJson: JSON.stringify(mapped.verificationErrors),
        })
        domains.push({ id: row.id, hostname: row.hostname, status: mapped.status, verificationErrors: mapped.verificationErrors, createdAt: row.createdAt })
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
    const record = await addCustomDomain(repo, {
      siteId: app.siteId,
      hostname,
      isOwner: isOwner(app),
      isPaid: (await getBillingStatus(app.workspaceId)) === 'active',
      appHost: appHost(),
      platformZone: publicBlogBaseDomain() ?? '',
    })

    // PROD: provision the Cloudflare custom hostname and reflect its initial status.
    if (customHostnameProvisioningEnabled()) {
      const payload = await createCustomHostname(record.hostname)
      if (payload?.id) {
        const mapped = mapCustomHostnameStatus(payload)
        await repo.setProvisioning(record.id, app.siteId, {
          cloudflareCustomHostnameId: payload.id,
          status: mapped.status,
          verificationErrorsJson: JSON.stringify(mapped.verificationErrors),
        })
        return { ok: true, domain: { ...toView(record), status: mapped.status, verificationErrors: mapped.verificationErrors } }
      }
    }
    return { ok: true, domain: toView(record) }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message }
    throw error
  }
}

export async function removeCustomDomainForApp(app: AppUserContext, domainId: string): Promise<RemoveCustomDomainResult> {
  try {
    const repo = createD1DomainRepository(env.DB)
    // Look up the CF hostname id before deletion (owner-scoped), so teardown only runs for an owner.
    let cfId: string | null = null
    if (customHostnameProvisioningEnabled() && isOwner(app)) {
      cfId = (await listCustomDomains(repo, app.siteId)).find((d) => d.id === domainId)?.cloudflareCustomHostnameId ?? null
    }
    await removeCustomDomain(repo, { siteId: app.siteId, domainId, isOwner: isOwner(app) })
    if (cfId) await deleteCustomHostname(cfId) // best-effort, reached only when our row was actually removed
    return { ok: true }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message }
    throw error
  }
}
