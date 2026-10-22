import type { BillingStatus } from '@vc/core'
import { ForbiddenError } from '@vc/core'
import { createDataAccess, type ManagedPurgeConflict } from '@vc/db'
import { Polar } from '@polar-sh/sdk'
import { LAUNCH_OFFER, MANAGED_CLAIM_CHECKOUT_TTL_SECONDS, PRICING, pastDueGraceEndsAt } from '@vc/config'
import { validateEvent } from '@polar-sh/sdk/webhooks'
import { HTTPClient } from '@polar-sh/sdk/lib/http.js'
import { POLAR_API_VERSION } from '@vc/config'
import { env } from 'cloudflare:workers'
import {
  applyPolarWebhookAtomically,
  polarCancelAtPeriodEnd,
  polarEventId,
  polarSourceTimestampMs,
  type WebhookApplyResult,
} from '@/server/polar-webhook-receipts'
import type { AppUserContext } from '@/server/onboarding'
import { sendPurgeConflictEmail } from '@/server/email'

type PolarWebhookEvent = { id?: unknown; type: string; timestamp?: unknown; data?: Record<string, unknown> }

export type BillingSnapshot = {
  status: BillingStatus
  /** Epoch seconds. */
  currentPeriodEnd: number | null
  polarCustomerId: string | null
  /** Polar cancel-at-period-end flag; null when unknown (self-hosted, no row, no subscription webhook yet). */
  cancelAtPeriodEnd: boolean | null
  /** First past-due transition and grace deadline, epoch milliseconds. */
  pastDueSince: number | null
  graceEndsAt: number | null
}

export function isSelfHosted() {
  return String(env.SELF_HOSTED) === 'true'
}

export async function ensureBillingRow(workspaceId: string, status: BillingStatus = 'none') {
  const db = createDataAccess(env.DB)
  await db.billing.ensureBillingRow(workspaceId, status)
}

export async function getBilling(workspaceId: string): Promise<BillingSnapshot> {
  if (isSelfHosted()) {
    return { status: 'active', currentPeriodEnd: null, polarCustomerId: null, cancelAtPeriodEnd: null, pastDueSince: null, graceEndsAt: null }
  }
  const db = createDataAccess(env.DB)
  const row = await db.billing.getBillingRecord(workspaceId)
  return {
    status: row?.status ?? 'none',
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    polarCustomerId: row?.polarCustomerId ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? null,
    pastDueSince: row?.pastDueSince ?? null,
    graceEndsAt: row ? pastDueGraceEndsAt(row) : null,
  }
}

export async function getBillingStatus(workspaceId: string): Promise<BillingStatus> {
  const billing = await getBilling(workspaceId)
  return billing.status
}

export async function getBillingStatusForSite(siteId: string): Promise<BillingStatus> {
  const db = createDataAccess(env.DB)
  const workspaceId = await db.billing.getWorkspaceIdForSite(siteId)
  return workspaceId ? getBillingStatus(workspaceId) : 'none'
}

/** Every Polar request carries our pinned API contract (see POLAR_API_VERSION). */
export function pinnedPolarHttpClient(fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const client = new HTTPClient(fetcher ? { fetcher } : undefined)
  client.addHook('beforeRequest', (request) => {
    const pinned = new Request(request)
    pinned.headers.set('Polar-Version', POLAR_API_VERSION)
    return pinned
  })
  return client
}

function polar() {
  if (!env.POLAR_ACCESS_TOKEN) return null
  return new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER === 'sandbox' ? 'sandbox' : 'production',
    httpClient: pinnedPolarHttpClient(),
  })
}

export type CheckoutInterval = 'monthly' | 'yearly'

export type BillingMutationResult =
  | { kind: 'ok'; url: string }
  | { kind: 'error'; code: string }

function requireOwner(app: AppUserContext) {
  if (app.actor.type !== 'human' || app.actor.role !== 'owner') {
    throw new ForbiddenError('Owner access required')
  }
}

/** Polar retry key scoped to the selected offer. */
export function checkoutIdempotencyKey(workspaceId: string, interval: CheckoutInterval, productId: string, discountId?: string) {
  return `vc-checkout:${workspaceId}:${interval}:${productId}:${discountId ?? 'none'}`
}

export type PolarOpenCheckout = {
  url?: string | null
  status?: string | null
  expiresAt?: Date | string | null
  productId?: string | null
  discountId?: string | null
  currency?: string | null
  netAmount?: number | null
}

/** Reuse only an open checkout for the exact offer and pre-tax first-period price. */
export function pickReusableOpenCheckoutUrl(
  items: PolarOpenCheckout[],
  productId: string,
  discountId: string | undefined,
  expectedNetAmount: number,
  nowMs: number = Date.now(),
): string | null {
  for (const item of items) {
    if (item.productId !== productId || (item.discountId ?? null) !== (discountId ?? null)) continue
    if (item.currency?.toLowerCase() !== 'usd' || item.netAmount !== expectedNetAmount) continue
    if (item.status != null && item.status !== 'open') continue
    if (!item.url) continue
    if (item.expiresAt != null) {
      const expiresMs =
        item.expiresAt instanceof Date ? item.expiresAt.getTime() : Date.parse(String(item.expiresAt))
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) continue
    }
    return item.url
  }
  return null
}

export type ListOpenPolarCheckouts = (query: {
  externalCustomerId: string
  productId: string
}) => Promise<PolarOpenCheckout[]>

export type CreatePolarCheckout = (
  body: {
    products: string[]
    discountId?: string
    successUrl: string
    returnUrl: string
    externalCustomerId: string
    customerEmail: string
    customerName: string
    metadata: { workspaceId: string }
    customerMetadata: { workspaceId: string }
  },
  options?: { headers?: HeadersInit },
) => Promise<PolarOpenCheckout>

/**
 * Marks a recorded checkout attempt as resolved: the checkout ended without a
 * claim, so the sweep must stop waiting for it. The attempt still blocks the
 * purge until its guard window ends.
 */
async function resolveCheckoutAttempt(workspaceId: string, now: number): Promise<void> {
  await createDataAccess(env.DB).managedSites.resolveClaimCheckoutAttempt(workspaceId, now)
}

/**
 * Sends the refund notice for a paid claim that arrived for a blog the purge
 * is deleting, and marks the record as notified. A failed mail is not fatal:
 * the record stays unnotified, so the claim sweep sends it again until the
 * mail is accepted.
 */
async function notifyPurgeConflict(conflict: ManagedPurgeConflict): Promise<void> {
  if (conflict.notifiedAt !== null) return
  try {
    await sendPurgeConflictEmail({
      workspaceId: conflict.workspaceId,
      siteId: conflict.siteId,
      polarCustomerId: conflict.polarCustomerId,
      polarSubscriptionId: conflict.polarSubscriptionId,
      polarOrderId: conflict.polarOrderId,
      polarCheckoutId: conflict.polarCheckoutId,
      eventType: conflict.eventType,
      eventId: conflict.eventId,
    })
    await createDataAccess(env.DB).managedSites.markPurgeConflictNotified(
      conflict.id,
      Math.floor(Date.now() / 1000),
    )
  } catch (error) {
    console.warn('[polar-webhook] purge conflict notice failed', {
      conflictId: conflict.id,
      error: String(error),
    })
  }
}

export async function createCheckoutSessionForApp(
  app: AppUserContext,
  interval: CheckoutInterval,
  deps?: { createCheckout?: CreatePolarCheckout; listOpenCheckouts?: ListOpenPolarCheckouts },
): Promise<BillingMutationResult> {
  try {
    requireOwner(app)
  } catch {
    return { kind: 'error', code: 'owner_required' }
  }
  if (isSelfHosted()) return { kind: 'error', code: 'self_hosted' }

  const db = createDataAccess(env.DB)
  // A blog whose purge is under way must not be sold: the intent is the
  // irreversible decision to delete it, so a checkout here would take the
  // customer's money for a blog that cannot come back. A finished intent is
  // only the trace of a blog that was deleted; a blog that was provisioned
  // again may be sold again.
  if (await db.managedSites.getActivePurgeIntentByWorkspaceId(app.workspaceId)) {
    return { kind: 'error', code: 'purge_in_progress' }
  }
  // A workspace with a LIVE AutoSEOPilot sponsorship is not for sale: the
  // plan already includes the blog. A revoked sponsorship is the claim
  // window: buying VibeCMS Cloud there is exactly how the customer keeps
  // the blog, so it must reach the checkout.
  const managed = await db.managedSites.getSnapshotByWorkspaceId(app.workspaceId)
  if (managed && managed.entitlementStatus === 'active') {
    return { kind: 'error', code: 'managed_workspace' }
  }
  const existingBilling = await db.billing.getBillingRecord(app.workspaceId)
  if (existingBilling?.status === 'active') {
    return { kind: 'error', code: 'already_active' }
  }
  // past_due is a live subscription in Polar's payment-retry window: the fix is
  // updating the payment method in the portal, not a second subscription.
  // Ended states (none/canceled/unpaid — Polar revokes to unpaid once retries
  // are exhausted) may start a fresh checkout.
  if (existingBilling?.status === 'past_due') {
    return { kind: 'error', code: 'payment_past_due' }
  }

  const productId = interval === 'yearly' ? env.POLAR_YEARLY_PRODUCT_ID : env.POLAR_MONTHLY_PRODUCT_ID
  // Products carry the list price ($15 / $150). While launch pricing runs,
  // a Polar discount (duration: forever, so it stays while subscribed) brings
  // new checkouts to the launch price. Unset = list price.
  const launchDiscounts = env as unknown as { POLAR_LAUNCH_DISCOUNT_MONTHLY_ID?: string; POLAR_LAUNCH_DISCOUNT_YEARLY_ID?: string }
  const discountId = (interval === 'yearly'
    ? launchDiscounts.POLAR_LAUNCH_DISCOUNT_YEARLY_ID
    : launchDiscounts.POLAR_LAUNCH_DISCOUNT_MONTHLY_ID)?.trim() || undefined
  const expectedNetAmount = interval === 'yearly'
    ? (discountId ? LAUNCH_OFFER.annualUsd : PRICING.annualUsd) * 100
    : (discountId ? LAUNCH_OFFER.monthlyUsd : PRICING.monthlyUsd) * 100
  if (!productId) {
    return {
      kind: 'error',
      code: interval === 'yearly' ? 'yearly_unavailable' : 'polar_unconfigured',
    }
  }
  const client = polar()
  const listOpenCheckouts: ListOpenPolarCheckouts | null =
    deps?.listOpenCheckouts ??
    (client
      ? async (query) => {
          const page = await client.checkouts.list({
            externalCustomerId: query.externalCustomerId,
            productId: query.productId,
            status: 'open',
          })
          return page.result.items
        }
      : null)
  const createCheckout: CreatePolarCheckout | null =
    deps?.createCheckout ??
    (client
      ? (body, options) => client.checkouts.create(body, options)
      : null)
  if (!createCheckout) return { kind: 'error', code: 'polar_unconfigured' }

  // A checkout can be paid at Polar before its webhook reaches us. The
  // attempt is recorded before the checkout is handed out, so the claim sweep
  // waits for it instead of deleting a blog whose owner just claimed it.
  // The write carries the purge exclusion: a blog that is being deleted must
  // not take the customer's money, and the decision and the write cannot
  // race.
  const attemptNow = Math.floor(Date.now() / 1000)
  const attemptRecorded = await db.managedSites.recordClaimCheckoutAttempt(
    app.workspaceId,
    attemptNow,
    attemptNow + MANAGED_CLAIM_CHECKOUT_TTL_SECONDS,
  )
  if (!attemptRecorded) {
    return { kind: 'error', code: 'purge_in_progress' }
  }

  // Prefer reusing an existing open Polar checkout for this workspace/product before creating another.
  if (listOpenCheckouts) {
    try {
      const openItems = await listOpenCheckouts({
        externalCustomerId: app.workspaceId,
        productId,
      })
      const existingUrl = pickReusableOpenCheckoutUrl(openItems, productId, discountId, expectedNetAmount)
      if (existingUrl) return { kind: 'ok', url: existingUrl }
    } catch (error) {
      console.error('polar open checkout list failed', error)
    }
  }

  try {
    const session = await createCheckout(
      {
        products: [productId],
        ...(discountId ? { discountId } : {}),
        successUrl: `${env.APP_URL}/dashboard?ok=billing_success&checkout_id={CHECKOUT_ID}`,
        returnUrl: `${env.APP_URL}/dashboard/billing`,
        externalCustomerId: app.workspaceId,
        customerEmail: app.user.email,
        customerName: app.user.name,
        metadata: { workspaceId: app.workspaceId },
        customerMetadata: { workspaceId: app.workspaceId },
      },
      { headers: { 'Idempotency-Key': checkoutIdempotencyKey(app.workspaceId, interval, productId, discountId) } },
    )
    if (session.productId !== productId || (session.discountId ?? null) !== (discountId ?? null)
      || session.currency?.toLowerCase() !== 'usd' || session.netAmount !== expectedNetAmount) {
      console.error('polar checkout offer mismatch', { requestedProductId: productId, requestedDiscountId: discountId ?? null,
        returnedProductId: session.productId, returnedDiscountId: session.discountId,
        currency: session.currency, netAmount: session.netAmount, expectedNetAmount })
      await resolveCheckoutAttempt(app.workspaceId, Math.floor(Date.now() / 1000))
      return { kind: 'error', code: 'checkout_failed' }
    }
    if (!session.url) {
      await resolveCheckoutAttempt(app.workspaceId, Math.floor(Date.now() / 1000))
      return { kind: 'error', code: 'checkout_failed' }
    }
    return { kind: 'ok', url: session.url }
  } catch (error) {
    console.error('polar checkout failed', error)
    await resolveCheckoutAttempt(app.workspaceId, Math.floor(Date.now() / 1000))
    return { kind: 'error', code: 'checkout_failed' }
  }
}

export async function createPortalSessionForApp(app: AppUserContext): Promise<BillingMutationResult> {
  try {
    requireOwner(app)
  } catch {
    return { kind: 'error', code: 'owner_required' }
  }
  if (isSelfHosted()) return { kind: 'error', code: 'self_hosted' }
  const billing = await getBilling(app.workspaceId)
  if (!billing.polarCustomerId && billing.status === 'none') {
    return { kind: 'error', code: 'billing_required' }
  }
  const client = polar()
  if (!client) return { kind: 'error', code: 'polar_unconfigured' }
  try {
    const session = await client.customerSessions.create({
      externalCustomerId: app.workspaceId,
      returnUrl: `${env.APP_URL}/dashboard/billing`,
    })
    if (!session.customerPortalUrl) return { kind: 'error', code: 'polar_unconfigured' }
    return { kind: 'ok', url: session.customerPortalUrl }
  } catch {
    return { kind: 'error', code: 'polar_unconfigured' }
  }
}

function subscriptionStatus(value: unknown): BillingStatus {
  if (value === 'trialing') return 'active'
  if (value === 'active' || value === 'past_due' || value === 'canceled' || value === 'unpaid') return value
  if (value === 'incomplete' || value === 'incomplete_expired') return 'unpaid'
  return 'none'
}

/** current_period_end stays in epoch seconds (entitlement checks compare seconds). */
function epochSeconds(value: unknown) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000)
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000)
  }
  return typeof value === 'number' ? value : null
}

function headerRecord(headers: Headers) {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

function stringField(data: Record<string, unknown>, camelKey: string, snakeKey: string) {
  const camelValue = data[camelKey]
  if (typeof camelValue === 'string') return camelValue
  const snakeValue = data[snakeKey]
  return typeof snakeValue === 'string' ? snakeValue : undefined
}

function workspaceIdFrom(data: Record<string, unknown>) {
  const metadata = data.metadata
  const rootCustomerMetadata = data.customer_metadata
  const customerMetadata =
    typeof data.customer === 'object' && data.customer
      ? (data.customer as Record<string, unknown>).metadata
      : undefined
  for (const source of [metadata, rootCustomerMetadata, customerMetadata]) {
    if (typeof source === 'object' && source && 'workspaceId' in source) {
      return String((source as Record<string, unknown>).workspaceId)
    }
  }
  return stringField(data, 'externalCustomerId', 'external_customer_id')
}

export async function handlePolarWebhook(request: Request) {
  if (isSelfHosted()) return Response.json({ received: true, ignored: true })
  const payload = await request.text()
  if (!env.POLAR_WEBHOOK_SECRET) {
    return new Response('Missing webhook secret', { status: 500 })
  }
  let event: PolarWebhookEvent
  try {
    event = validateEvent(payload, headerRecord(request.headers), env.POLAR_WEBHOOK_SECRET) as PolarWebhookEvent
  } catch {
    return new Response('Invalid signature', { status: 401 })
  }
  const data = event.data
  if (!data) return Response.json({ received: true })
  const workspaceId = workspaceIdFrom(data)
  if (!workspaceId) return Response.json({ received: true })
  const status = event.type.startsWith('subscription.')
    ? subscriptionStatus(data.status)
    : event.type === 'checkout.updated' && data.status === 'succeeded'
      ? 'active'
      : undefined
  if (!status) return Response.json({ received: true })
  const sourceTimestamp = polarSourceTimestampMs(event, data, request.headers)
  const eventId = await polarEventId(event, payload, request.headers)
  const subscriptionId =
    stringField(data, 'subscriptionId', 'subscription_id') ??
    (typeof data.id === 'string' && event.type.startsWith('subscription.') ? data.id : null)
  const polarOrderId = stringField(data, 'orderId', 'order_id') ?? null
  const polarCheckoutId =
    stringField(data, 'checkoutId', 'checkout_id') ??
    (event.type === 'checkout.updated' && typeof data.id === 'string' ? data.id : null)
  let result: WebhookApplyResult
  try {
    result = await applyPolarWebhookAtomically(env.DB, {
      eventId,
      workspaceId,
      eventType: event.type,
      sourceTimestamp,
      appliedStatus: status,
      polarCustomerId: stringField(data, 'customerId', 'customer_id') ?? null,
      polarSubscriptionId: subscriptionId,
      polarOrderId,
      polarCheckoutId,
      currentPeriodEnd: epochSeconds(data.currentPeriodEnd ?? data.current_period_end),
      cancelAtPeriodEnd: polarCancelAtPeriodEnd(event.type, data),
    })
  } catch (error) {
    // The billing row hangs on the workspace, so an event for a workspace
    // that is gone fails on the write. That is the purged-blog case, and the
    // customer may have paid for a blog that no longer exists. The record
    // has to be written: if it cannot, the webhook fails too, so Polar
    // retries instead of us losing the payment. Any other failure is a real
    // error: the receipt stays rolled back and Polar retries.
    const workspace = await env.DB.prepare('SELECT 1 AS ok FROM workspaces WHERE id = ?')
      .bind(workspaceId)
      .first<{ ok: number }>()
    const purged = workspace
      ? null
      : await createDataAccess(env.DB).managedSites.getPurgeIntentByWorkspaceId(workspaceId)
    if (!purged) throw error
    await createDataAccess(env.DB).managedSites.recordPurgeConflict({
      workspaceId,
      siteId: purged.siteId,
      polarCustomerId: stringField(data, 'customerId', 'customer_id') ?? null,
      polarSubscriptionId: subscriptionId,
      polarOrderId,
      polarCheckoutId,
      eventId,
      eventType: event.type,
      appliedStatus: status,
      now: Math.floor(Date.now() / 1000),
    })
    result = { kind: 'conflict' }
  }
  if (result.kind === 'conflict') {
    // The blog is being deleted, or it is already gone: a claim must not
    // resurrect it, and the workspace must not become paid behind the purge.
    // The event is not applied, so the customer is never billed for a
    // deleted blog. But the customer may have PAID for it, so the event is
    // recorded (durably, in the same transaction as the receipt) and the
    // operator is alerted: the money has to be refunded by hand. The webhook
    // is answered, so Polar stops retrying.
    const managed = createDataAccess(env.DB).managedSites
    const intent = await managed.getPurgeIntentByWorkspaceId(workspaceId)
    const conflict = await managed.recordPurgeConflict({
      workspaceId,
      siteId: intent?.siteId ?? null,
      polarCustomerId: stringField(data, 'customerId', 'customer_id') ?? null,
      polarSubscriptionId: subscriptionId,
      polarOrderId,
      polarCheckoutId,
      eventId,
      eventType: event.type,
      appliedStatus: status,
      now: Math.floor(Date.now() / 1000),
    })
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'polar_webhook_purge_conflict',
        workspaceId,
        conflictId: conflict.id,
        siteId: conflict.siteId,
        polarCustomerId: conflict.polarCustomerId,
        polarSubscriptionId: conflict.polarSubscriptionId,
        polarOrderId: conflict.polarOrderId,
        polarCheckoutId: conflict.polarCheckoutId,
        eventId,
        eventType: event.type,
        appliedStatus: status,
        note: 'a paid event arrived for a managed blog that is purged or being purged: refund by hand',
      }),
    )
    await notifyPurgeConflict(conflict)
    return Response.json({ received: true, result: result.kind })
  }
  if (result.kind === 'applied') {
    // The checkout ended: the sweep must stop waiting for a claim that
    // either landed or will never land. The attempt still blocks the purge
    // until its guard window ends.
    await resolveCheckoutAttempt(workspaceId, Math.floor(Date.now() / 1000))
  }
  return Response.json({ received: true, result: result.kind })
}
