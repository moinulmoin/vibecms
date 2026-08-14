import { MEDIA } from '@vc/config'
import { resolveEffectiveEntitlementForSite } from '@/server/effective-entitlement'

export class MediaQuotaError extends Error {
  code: 'billing_required' | 'media_quota_paid'
  constructor(code: 'billing_required' | 'media_quota_paid') {
    super(code)
    this.code = code
  }
}

export type MediaUploadQuota = {
  skipQuota: boolean
  limit: number
}

/** Billing + plan gate for media uploads. Reservation itself is atomic with the pending op row. */
export async function assertMediaUploadAllowed(siteId: string): Promise<MediaUploadQuota> {
  const entitlement = await resolveEffectiveEntitlementForSite(siteId)
  if (entitlement.access === 'self_hosted') return { skipQuota: true, limit: 0 }
  if (!entitlement.effective) throw new MediaQuotaError('billing_required')
  return { skipQuota: false, limit: MEDIA.paidStorageBytes }
}
