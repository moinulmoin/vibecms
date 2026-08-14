import type { BillingStatus } from '@vc/core'
import {
  createDataAccess,
  type EffectiveHostedEntitlement,
  type ManagedEntitlementResolutionOptions,
} from '@vc/db'
import { env } from 'cloudflare:workers'

export type EffectiveEntitlementSource = EffectiveHostedEntitlement['activeSources'][number] | 'none'

/**
 * API-facing entitlement shape. `rawPolarStatus` is deliberately separate
 * from the effective result so managed sponsorship never masquerades as a
 * Polar subscription in responses or billing-specific code.
 */
export type ApiEffectiveEntitlement = EffectiveHostedEntitlement & {
  rawPolarStatus: BillingStatus
  source: EffectiveEntitlementSource
}

export type EntitlementReadOptions = Partial<ManagedEntitlementResolutionOptions>

function currentTime(): number {
  return Math.floor(Date.now() / 1000)
}

function selfHostedMode(): boolean {
  return String(env.SELF_HOSTED) === 'true'
}

function resolveOptions(options?: EntitlementReadOptions): ManagedEntitlementResolutionOptions {
  return {
    selfHosted: options?.selfHosted ?? selfHostedMode(),
    now: options?.now ?? currentTime(),
  }
}

function sourceFor(entitlement: EffectiveHostedEntitlement): EffectiveEntitlementSource {
  if (entitlement.activeSources.includes('self_hosted')) return 'self_hosted'
  if (entitlement.activeSources.includes('polar')) return 'polar'
  if (entitlement.activeSources.includes('managed_sponsorship')) return 'managed_sponsorship'
  return 'none'
}

export function toApiEffectiveEntitlement(
  entitlement: EffectiveHostedEntitlement | null,
): ApiEffectiveEntitlement {
  if (!entitlement) {
    return {
      effective: false,
      access: 'hosted_free',
      activeSources: [],
      effectiveUntil: null,
      rawPolarStatus: 'none',
      source: 'none',
      polar: { status: null, currentPeriodEnd: null, active: false },
      managedSponsorship: { status: null, expiresAt: null, active: false },
    }
  }

  return {
    ...entitlement,
    rawPolarStatus: entitlement.polar.status ?? 'none',
    source: sourceFor(entitlement),
  }
}

export async function resolveEffectiveEntitlementForSite(
  siteId: string,
  options?: EntitlementReadOptions,
): Promise<ApiEffectiveEntitlement> {
  const entitlement = await createDataAccess(env.DB).managedSites.resolveSite(siteId, resolveOptions(options))
  return toApiEffectiveEntitlement(entitlement)
}

export async function resolveEffectiveEntitlementForWorkspace(
  workspaceId: string,
  options?: EntitlementReadOptions,
): Promise<ApiEffectiveEntitlement> {
  const entitlement = await createDataAccess(env.DB).managedSites.resolveWorkspace(
    workspaceId,
    resolveOptions(options),
  )
  return toApiEffectiveEntitlement(entitlement)
}

/**
 * Core publishing still accepts BillingStatus. Convert only at that
 * boundary: an effective managed/self-hosted entitlement becomes synthetic
 * `active`; otherwise preserve the raw Polar status.
 */
export function billingStatusForCore(entitlement: ApiEffectiveEntitlement): BillingStatus {
  return entitlement.effective ? 'active' : entitlement.rawPolarStatus
}

export async function getCoreBillingStatusForSite(
  siteId: string,
  options?: EntitlementReadOptions,
): Promise<BillingStatus> {
  return billingStatusForCore(await resolveEffectiveEntitlementForSite(siteId, options))
}

export async function getCoreBillingStatusForWorkspace(
  workspaceId: string,
  options?: EntitlementReadOptions,
): Promise<BillingStatus> {
  return billingStatusForCore(await resolveEffectiveEntitlementForWorkspace(workspaceId, options))
}
