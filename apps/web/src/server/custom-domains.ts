import { env } from 'cloudflare:workers'
import { addCustomDomain, AppError, type DomainRecord, listCustomDomains, removeCustomDomain } from '@vc/core'
import { createD1DomainRepository } from '@vc/db'
import { getBillingStatus } from '~/server/billing'
import type { AppUserContext } from '~/server/onboarding'
import { publicBlogBaseDomain } from '~/server/onboarding'

export type CustomDomainView = {
  id: string
  hostname: string
  status: DomainRecord['status']
  verificationErrors: string[]
  createdAt: number
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

function toView(record: DomainRecord): CustomDomainView {
  return {
    id: record.id,
    hostname: record.hostname,
    status: record.status,
    verificationErrors: record.verificationErrorsJson ? (JSON.parse(record.verificationErrorsJson) as string[]) : [],
    createdAt: record.createdAt,
  }
}

function isOwner(app: AppUserContext): boolean {
  return app.actor.type === 'human' && app.actor.role === 'owner'
}

export async function listCustomDomainsForApp(app: AppUserContext): Promise<CustomDomainView[]> {
  if (!isOwner(app)) return []
  const repo = createD1DomainRepository(env.DB)
  const rows = await listCustomDomains(repo, app.siteId)
  return rows.map(toView)
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
    return { ok: true, domain: toView(record) }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message }
    throw error
  }
}

export async function removeCustomDomainForApp(app: AppUserContext, domainId: string): Promise<RemoveCustomDomainResult> {
  try {
    const repo = createD1DomainRepository(env.DB)
    await removeCustomDomain(repo, { siteId: app.siteId, domainId, isOwner: isOwner(app) })
    return { ok: true }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message }
    throw error
  }
}
