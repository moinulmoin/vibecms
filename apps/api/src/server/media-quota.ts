import { hasActiveSubscription } from '@vc/core'
import { MEDIA } from '@vc/config'
import { getBillingStatusForSite, isSelfHosted } from '@/server/billing'

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
  if (isSelfHosted()) return { skipQuota: true, limit: 0 }
  const billingStatus = await getBillingStatusForSite(siteId)
  if (!hasActiveSubscription(billingStatus)) throw new MediaQuotaError('billing_required')
  return { skipQuota: false, limit: MEDIA.paidStorageBytes }
}
