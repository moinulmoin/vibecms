import { describe, expect, it } from 'vitest'
import { FREE_TIER, MEDIA } from '@vc/config'
import { PLAN_ROWS } from './BillingPage'

describe('plan comparison', () => {
  it('shows the draft, image, and agent request allowances', () => {
    expect(PLAN_ROWS).toContainEqual({ label: 'Drafts', free: `${FREE_TIER.drafts} at a time`, paid: 'Unlimited' })
    expect(PLAN_ROWS).toContainEqual({ label: 'Image uploads', free: `${FREE_TIER.images} images`, paid: MEDIA.paidStorageLabel })
    expect(PLAN_ROWS).toContainEqual({ label: 'Agent requests', free: 'Limited', paid: 'Unlimited (fair use)' })
  })
})
