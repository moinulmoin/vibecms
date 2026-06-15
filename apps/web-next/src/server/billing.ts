import type { BillingStatus } from '@vc/core'
import { env } from 'cloudflare:workers'

type BillingRow = { status: BillingStatus }
type SiteWorkspaceRow = { workspace_id: string }

export function isSelfHosted() {
  return String(env.SELF_HOSTED) === 'true'
}

export async function ensureBillingRow(workspaceId: string, status: BillingStatus = 'none') {
  const timestamp = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(`billing_${workspaceId}`, workspaceId, status, null, timestamp, timestamp)
    .run()
}

export async function getBilling(workspaceId: string) {
  if (isSelfHosted()) {
    return { status: 'active' as BillingStatus, currentPeriodEnd: null }
  }
  const row = await env.DB.prepare(
    'SELECT status, current_period_end FROM billing_customers WHERE workspace_id = ? LIMIT 1',
  )
    .bind(workspaceId)
    .first<{ status: BillingStatus; current_period_end: number | null }>()
  return {
    status: row?.status ?? 'none',
    currentPeriodEnd: row?.current_period_end ?? null,
  }
}

export async function getBillingStatus(workspaceId: string): Promise<BillingStatus> {
  if (isSelfHosted()) return 'active'
  const row = await env.DB.prepare('SELECT status FROM billing_customers WHERE workspace_id = ? LIMIT 1')
    .bind(workspaceId)
    .first<BillingRow>()
  return row?.status ?? 'none'
}

export async function getBillingStatusForSite(siteId: string): Promise<BillingStatus> {
  const site = await env.DB.prepare('SELECT workspace_id FROM sites WHERE id = ? LIMIT 1')
    .bind(siteId)
    .first<SiteWorkspaceRow>()
  return site ? getBillingStatus(site.workspace_id) : 'none'
}