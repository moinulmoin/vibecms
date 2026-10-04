import { FREE_TIER, MEDIA } from '@vc/config'
import { resolveEffectiveEntitlementForSite } from '@/server/effective-entitlement'

export type MediaUploadQuota = {
  skipQuota: boolean
  limit: number
  quotaType?: 'bytes' | 'images'
}

/** Billing + plan gate for media uploads. Reservation itself is atomic with the pending op row. */
export async function assertMediaUploadAllowed(siteId: string): Promise<MediaUploadQuota> {
  const entitlement = await resolveEffectiveEntitlementForSite(siteId)
  if (entitlement.access === 'self_hosted') return { skipQuota: true, limit: 0 }
  if (!entitlement.effective) return { skipQuota: false, limit: FREE_TIER.images, quotaType: 'images' }
  return { skipQuota: false, limit: MEDIA.paidStorageBytes, quotaType: 'bytes' }
}
