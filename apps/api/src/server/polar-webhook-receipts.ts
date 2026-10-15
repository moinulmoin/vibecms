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

/** Epoch ms from a Date, ISO string, or epoch number (seconds or ms). */
function epochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Below 1e11 can only be epoch seconds (1e11 ms is 1973).
    return value < 100_000_000_000 ? value * 1000 : value
  }
  return null
}

/**
 * Webhook ordering key in epoch MILLISECONDS. Preference: the resource's
 * modifiedAt (when Polar last changed the object) > the signed envelope
 * timestamp > the `webhook-timestamp` header (epoch seconds) > the resource's
 * createdAt > now.
 */
export function polarSourceTimestampMs(
  event: { timestamp?: unknown },
  data: Record<string, unknown>,
  headers: Headers,
  nowMs: number = Date.now(),
): number {
  const modified = epochMs(data.modifiedAt ?? data.modified_at)
  if (modified !== null) return modified
  const envelope = epochMs(event.timestamp)
  if (envelope !== null) return envelope
  const header = headers.get('webhook-timestamp')
  if (header && /^\d+$/.test(header.trim())) return Number(header.trim()) * 1000
  return epochMs(data.createdAt ?? data.created_at) ?? nowMs
}

/**
 * Subscription payloads carry Polar's cancelAtPeriodEnd; anything else (checkout
 * events, missing/malformed flag) yields null so the stored flag is unchanged.
 */
export function polarCancelAtPeriodEnd(eventType: string, data: Record<string, unknown>): boolean | null {
  if (!eventType.startsWith('subscription.')) return null
  const value = data.cancelAtPeriodEnd ?? data.cancel_at_period_end
  return typeof value === 'boolean' ? value : null
}

export type PolarWebhookApplyInput = {
  eventId: string
  workspaceId: string
  eventType: string
  /** Ordering key, epoch milliseconds (see polarSourceTimestampMs). */
  sourceTimestamp: number
  appliedStatus: BillingStatus
  polarCustomerId: string | null
  polarSubscriptionId: string | null
  /** Polar current_period_end, epoch seconds. */
  currentPeriodEnd: number | null
  /** null leaves the stored flag unchanged (checkout events). */
  cancelAtPeriodEnd: boolean | null
}

type PriorBillingRow = { status: BillingStatus; webhook_updated_at: number | null; webhook_event_id: string | null }

/**
 * One D1 transaction reads the prior status, inserts a receipt, creates a missing
 * billing row, then updates two independently ordered groups:
 * - status/customer/grace: webhook_updated_at, for every event;
 * - subscription ID/period/cancel flag: subscription_updated_at, subscription events only.
 * Each group accepts only strictly newer timestamps (equal retains stored state).
 *
 * Every billing write requires this request's fresh receipt nonce. A duplicate
 * receipt keeps its old nonce, so redelivery cannot mutate billing even when a
 * legacy watermark used creation time rather than modification time.
 *
 * Grace starts only on an accepted transition into past_due. Repeated past_due
 * preserves the clock, including a legacy NULL (no retroactive grace).
 * Accepted limitation: if a later past_due arrives before a delayed failure,
 * grace starts at the first applied event. Polar retries while our endpoint is
 * failing; this favours the customer by at most that delivery delay.
 *
 * Result: no receipt inserted → duplicate; either group changed → applied;
 * otherwise → stale.
 *
 * An equal-timestamp status conflict is retained and logged as a structured
 * warning, even when the subscription-field group applies independently.
 *
 * If any statement throws, D1 rolls back the entire batch — neither the
 * receipt nor the billing row is committed, so a retry is not masked.
 */
export async function applyPolarWebhookAtomically(
  db: D1Database,
  input: PolarWebhookApplyInput,
): Promise<WebhookApplyResult> {
  const now = Math.floor(Date.now() / 1000)
  const subscriptionEvent = input.eventType.startsWith('subscription.')
  const applyNonce = crypto.randomUUID()

  const priorStmt = db
    .prepare('SELECT status, webhook_updated_at, webhook_event_id FROM billing_customers WHERE workspace_id = ?')
    .bind(input.workspaceId)

  const receiptStmt = db
    .prepare(
      `INSERT INTO polar_webhook_receipts
         (event_id, workspace_id, event_type, source_timestamp, applied_status, created_at, apply_nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO NOTHING`,
    )
    .bind(
      input.eventId,
      input.workspaceId,
      input.eventType,
      input.sourceTimestamp,
      input.appliedStatus,
      now,
      applyNonce,
    )

  const createStmt = db
    .prepare(
      `INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at)
       SELECT ?, ?, 'none', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM polar_webhook_receipts WHERE event_id = ? AND apply_nonce = ?
       )
       ON CONFLICT(workspace_id) DO NOTHING`,
    )
    .bind(`billing_${input.workspaceId}`, input.workspaceId, now, now, input.eventId, applyNonce)

  const statusStmt = db
    .prepare(
      `UPDATE billing_customers SET
         polar_customer_id = COALESCE(?, polar_customer_id),
         past_due_since = CASE
           WHEN ? <> 'past_due' THEN NULL
           WHEN status = 'past_due' THEN past_due_since
           ELSE ?
         END,
         status = ?,
         webhook_event_id = ?,
         webhook_updated_at = ?,
         updated_at = ?
       WHERE workspace_id = ?
         AND (webhook_updated_at IS NULL OR webhook_updated_at < ?)
         AND EXISTS (
           SELECT 1 FROM polar_webhook_receipts WHERE event_id = ? AND apply_nonce = ?
         )`,
    )
    .bind(
      input.polarCustomerId,
      input.appliedStatus,
      input.sourceTimestamp,
      input.appliedStatus,
      input.eventId,
      input.sourceTimestamp,
      now,
      input.workspaceId,
      input.sourceTimestamp,
      input.eventId,
      applyNonce,
    )

  const subscriptionStmt = db
    .prepare(
      `UPDATE billing_customers SET
         polar_subscription_id = ?,
         current_period_end = ?,
         cancel_at_period_end = COALESCE(?, cancel_at_period_end),
         subscription_updated_at = ?,
         updated_at = ?
       WHERE workspace_id = ? AND ?
         AND (subscription_updated_at IS NULL OR subscription_updated_at < ?)
         AND EXISTS (
           SELECT 1 FROM polar_webhook_receipts WHERE event_id = ? AND apply_nonce = ?
         )`,
    )
    .bind(
      input.polarSubscriptionId,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd === null ? null : input.cancelAtPeriodEnd ? 1 : 0,
      input.sourceTimestamp,
      now,
      input.workspaceId,
      subscriptionEvent ? 1 : 0,
      input.sourceTimestamp,
      input.eventId,
      applyNonce,
    )

  const [priorResult, receiptResult, , statusResult, subscriptionResult] = await db.batch([
    priorStmt, receiptStmt, createStmt, statusStmt, subscriptionStmt,
  ])

  const receiptChanges = receiptResult?.meta?.changes ?? 0
  const statusChanges = statusResult?.meta?.changes ?? 0
  const subscriptionChanges = subscriptionResult?.meta?.changes ?? 0

  if (receiptChanges === 0) return { kind: 'duplicate' }
  if (statusChanges === 0) {
    const prior = (priorResult?.results as PriorBillingRow[] | undefined)?.[0]
    if (prior && prior.webhook_updated_at === input.sourceTimestamp && prior.status !== input.appliedStatus) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'polar_webhook_equal_timestamp_conflict',
        workspaceId: input.workspaceId,
        sourceTimestamp: input.sourceTimestamp,
        storedEventId: prior.webhook_event_id,
        storedStatus: prior.status,
        incomingEventId: input.eventId,
        incomingEventType: input.eventType,
        incomingStatus: input.appliedStatus,
      }))
    }
    if (subscriptionChanges === 0) return { kind: 'stale' }
  }
  return { kind: 'applied' }
}
