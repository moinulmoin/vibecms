import { hasActiveSubscription } from '@vc/core'
import { MEDIA } from '@vc/config'
import { env } from 'cloudflare:workers'
import { getBillingStatusForSite } from '@/server/billing'
import { isSelfHosted } from '@/server/billing'

export class MediaQuotaError extends Error {
  code: 'billing_required' | 'media_quota_paid'
  constructor(code: 'billing_required' | 'media_quota_paid') {
    super(code)
    this.code = code
  }
}

/** Requires packages/db migration: sites.media_pending_bytes INTEGER NOT NULL DEFAULT 0 */
export async function reserveMediaBytes(siteId: string, sizeBytes: number): Promise<void> {
  if (isSelfHosted()) return
  const billingStatus = await getBillingStatusForSite(siteId)
  if (!hasActiveSubscription(billingStatus)) throw new MediaQuotaError('billing_required')
  const limit = MEDIA.paidStorageBytes
  const result = await env.DB.prepare(
    `UPDATE sites
     SET media_pending_bytes = media_pending_bytes + ?
     WHERE id = ?
       AND (
         SELECT COALESCE(SUM(size_bytes), 0) FROM assets WHERE site_id = sites.id
       ) + media_pending_bytes + ? <= ?`,
  )
    .bind(sizeBytes, siteId, sizeBytes, limit)
    .run()
  if (!result.meta.changes) throw new MediaQuotaError('media_quota_paid')
}

export async function releaseMediaReservation(siteId: string, sizeBytes: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE sites SET media_pending_bytes = MAX(0, media_pending_bytes - ?) WHERE id = ?`,
  )
    .bind(sizeBytes, siteId)
    .run()
}