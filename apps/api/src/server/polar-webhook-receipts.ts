import type { BillingStatus } from '@vc/core'

export type WebhookApplyResult =
  | { kind: 'applied' }
  | { kind: 'duplicate' }
  | { kind: 'stale' }

/**
 * Deterministic event ID for a Polar webhook.
 * Preference: event.id > webhook-id header > SHA-256(payload prefix).
 * Pure function — no D1, safe for normal Vitest.
 */
export async function polarEventId(
  event: { id?: unknown },
  payload: string,
  headers: Headers,
): Promise<string> {
  if (typeof event.id === 'string' && event.id.length > 0) return event.id
  const headerId = headers.get('webhook-id') ?? headers.get('x-polar-webhook-id')
  if (headerId) return headerId
  const bytes = new TextEncoder().encode(payload)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const digest = Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `payload:${digest}`
}

export type PolarWebhookApplyInput = {
  eventId: string
  workspaceId: string
  eventType: string
  sourceTimestamp: number
  appliedStatus: BillingStatus
  polarCustomerId: string | null
  polarSubscriptionId: string | null
  currentPeriodEnd: number | null
}

/**
 * Atomically record a Polar webhook receipt AND apply the billing update
 * in a single `db.batch()` (D1 atomic transaction).
 *
 * Receipt:  INSERT … ON CONFLICT(event_id) DO NOTHING.
 * Billing:  INSERT … ON CONFLICT(workspace_id) DO UPDATE … WHERE
 *           monotonic guard — newer source_timestamp wins; on equal
 *           timestamp, lexicographically higher event_id wins (deterministic
 *           tie-break). If the guard fails the UPDATE is a no-op.
 *
 * Result interpretation from `meta.changes`:
 *   receipt=0                 → duplicate (exact re-delivery)
 *   receipt=1, billing=0      → stale (new event, older timestamp)
 *   receipt=1, billing=1      → applied
 *
 * If any statement throws, D1 rolls back the entire batch — neither the
 * receipt nor the billing row is committed, so a retry is not masked.
 *
 * D1 is injected (no `cloudflare:workers` import) so tests run under
 * normal Vitest with a stub.
 */
export async function applyPolarWebhookAtomically(
  db: D1Database,
  input: PolarWebhookApplyInput,
): Promise<WebhookApplyResult> {
  const now = Math.floor(Date.now() / 1000)

  const receiptStmt = db
    .prepare(
      `INSERT INTO polar_webhook_receipts
         (event_id, workspace_id, event_type, source_timestamp, applied_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO NOTHING`,
    )
    .bind(
      input.eventId,
      input.workspaceId,
      input.eventType,
      input.sourceTimestamp,
      input.appliedStatus,
      now,
    )

  const billingStmt = db
    .prepare(
      `INSERT INTO billing_customers
         (id, workspace_id, polar_customer_id, polar_subscription_id, status,
          current_period_end, webhook_event_id, webhook_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         polar_customer_id  = COALESCE(excluded.polar_customer_id, billing_customers.polar_customer_id),
         polar_subscription_id = COALESCE(excluded.polar_subscription_id, billing_customers.polar_subscription_id),
         status              = excluded.status,
         current_period_end  = excluded.current_period_end,
         webhook_event_id    = excluded.webhook_event_id,
         webhook_updated_at  = excluded.webhook_updated_at,
         updated_at          = excluded.updated_at
       WHERE billing_customers.webhook_updated_at IS NULL
          OR billing_customers.webhook_updated_at < excluded.webhook_updated_at
          OR (billing_customers.webhook_updated_at = excluded.webhook_updated_at
              AND billing_customers.webhook_event_id < excluded.webhook_event_id)`,
    )
    .bind(
      `billing_${input.workspaceId}`,
      input.workspaceId,
      input.polarCustomerId,
      input.polarSubscriptionId,
      input.appliedStatus,
      input.currentPeriodEnd,
      input.eventId,
      input.sourceTimestamp,
      now,
      now,
    )

  const results = await db.batch([receiptStmt, billingStmt])

  const receiptChanges = results[0]?.meta?.changes ?? 0
  const billingChanges = results[1]?.meta?.changes ?? 0

  if (receiptChanges === 0) return { kind: 'duplicate' }
  if (billingChanges === 0) return { kind: 'stale' }
  return { kind: 'applied' }
}
