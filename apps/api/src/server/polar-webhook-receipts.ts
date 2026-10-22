import type { BillingStatus } from '@vc/core'
import { purgeConflictId } from '@vc/db'

export type WebhookApplyResult =
  | { kind: 'applied' }
  | { kind: 'duplicate' }
  | { kind: 'stale' }
  /** The workspace's blog is being deleted, or is already gone. */
  | { kind: 'conflict' }

/**
 * A workspace whose blog is being deleted, or whose blog is already gone.
 *
 * A finished intent whose site was provisioned again does not count: the blog
 * is back, so its subscription may apply. A finished intent whose site is
 * still gone means the customer paid for a blog that was deleted.
 */
const PURGED_BLOG_GUARD = `
  NOT EXISTS (
    SELECT 1 FROM autoseopilot_purge_intents p
    WHERE p.workspace_id = billing_customers.workspace_id
      AND (
        p.completed_at IS NULL
        OR NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = p.site_id)
      )
  )
`

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

/**
 * Whether the event proves a successful payment: a succeeded checkout, or a
 * subscription Polar reports as `active` (paid; a cancel at period end keeps
 * it active for the paid period). A trial, an incomplete, unpaid, past-due or
 * cancelled subscription is not a payment, so a late event of that kind for a
 * purged blog never asks for a refund.
 */
export function polarPaymentEvidence(eventType: string, data: Record<string, unknown>): boolean {
  if (eventType === 'checkout.updated') return data.status === 'succeeded'
  if (eventType.startsWith('subscription.')) return data.status === 'active'
  return false
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
  /** The Polar order id, when the event carries one. */
  polarOrderId: string | null
  /** The Polar checkout id, when the event carries one. */
  polarCheckoutId: string | null
  /** Polar current_period_end, epoch seconds. */
  currentPeriodEnd: number | null
  /** null leaves the stored flag unchanged (checkout events). */
  cancelAtPeriodEnd: boolean | null
  /** The event proves a successful payment (see polarPaymentEvidence). */
  paymentEvidence: boolean
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
         AND ${PURGED_BLOG_GUARD}
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
         AND ${PURGED_BLOG_GUARD}
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

  // The conflict record is written in the SAME transaction as the receipt: a
  // paid event for a blog that is purged (or already gone) must never be
  // lost, and if this write fails the receipt is rolled back with it, so
  // Polar retries instead of us losing the payment. Every late event is
  // recorded; payment_evidence marks the ones that owe a refund notice, and
  // notified_at stays NULL until that notice is accepted.
  const conflictStmt = db
    .prepare(
      `INSERT INTO autoseopilot_purge_conflicts (
         id, workspace_id, site_id, polar_customer_id, polar_subscription_id,
         polar_order_id, polar_checkout_id, event_id, event_type,
         applied_status, payment_evidence, notified_at, created_at
       )
       SELECT ?, ?, (
         SELECT p.site_id FROM autoseopilot_purge_intents p
         WHERE p.workspace_id = ? LIMIT 1
       ), ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
       WHERE EXISTS (
         SELECT 1 FROM autoseopilot_purge_intents p
         WHERE p.workspace_id = ?
           AND (
             p.completed_at IS NULL
             OR NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = p.site_id)
           )
       )
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      purgeConflictId(input.workspaceId, input.eventId),
      input.workspaceId,
      input.workspaceId,
      input.polarCustomerId,
      input.polarSubscriptionId,
      input.polarOrderId,
      input.polarCheckoutId,
      input.eventId,
      input.eventType,
      input.appliedStatus,
      input.paymentEvidence ? 1 : 0,
      now,
      input.workspaceId,
    )

  const [priorResult, receiptResult, , statusResult, subscriptionResult, conflictResult] = await db.batch([
    priorStmt, receiptStmt, createStmt, statusStmt, subscriptionStmt, conflictStmt,
  ])

  const receiptChanges = receiptResult?.meta?.changes ?? 0
  const statusChanges = statusResult?.meta?.changes ?? 0
  const subscriptionChanges = subscriptionResult?.meta?.changes ?? 0
  const conflictChanges = conflictResult?.meta?.changes ?? 0

  if (receiptChanges === 0) return { kind: 'duplicate' }
  // The conflict row was written in the same transaction as the receipt, so
  // its presence is the proof that the blog is being purged or is already
  // gone: the event was not applied (and, when it carries payment evidence,
  // the customer has to be refunded).
  if (conflictChanges > 0) return { kind: 'conflict' }
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
