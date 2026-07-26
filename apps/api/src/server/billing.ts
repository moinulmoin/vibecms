import type { BillingStatus } from '@vc/core'
import { ForbiddenError } from '@vc/core'
import { createDataAccess } from '@vc/db'
import { Polar } from '@polar-sh/sdk'
import { validateEvent } from '@polar-sh/sdk/webhooks'
import { env } from 'cloudflare:workers'
import { applyPolarWebhookAtomically, polarEventId } from '@/server/polar-webhook-receipts'
import type { AppUserContext } from '@/server/onboarding'

type PolarWebhookEvent = { id?: unknown; type: string; data?: Record<string, unknown> }

export type BillingSnapshot = {
  status: BillingStatus
  currentPeriodEnd: number | null
  polarCustomerId: string | null
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
    return { status: 'active', currentPeriodEnd: null, polarCustomerId: null }
  }
  const db = createDataAccess(env.DB)
  const row = await db.billing.getBillingRecord(workspaceId)
  return {
    status: row?.status ?? 'none',
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    polarCustomerId: row?.polarCustomerId ?? null,
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

function polar() {
  if (!env.POLAR_ACCESS_TOKEN) return null
  return new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER === 'sandbox' ? 'sandbox' : 'production',
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

/** Idempotency-Key for one logical checkout attempt (workspace + interval). Uses Polar's header facility within its supported retry window. */
export function checkoutIdempotencyKey(workspaceId: string, interval: CheckoutInterval) {
  return `vc-checkout:${workspaceId}:${interval}`
}

export type PolarOpenCheckout = {
  url?: string | null
  status?: string | null
  expiresAt?: Date | string | null
}

/** Pick a still-open, non-expired checkout URL when Polar already has one for this customer/product. */
export function pickReusableOpenCheckoutUrl(
  items: PolarOpenCheckout[],
  nowMs: number = Date.now(),
): string | null {
  for (const item of items) {
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
    successUrl: string
    returnUrl: string
    externalCustomerId: string
    customerEmail: string
    customerName: string
    metadata: { workspaceId: string }
    customerMetadata: { workspaceId: string }
  },
  options?: { headers?: HeadersInit },
) => Promise<{ url?: string | null }>

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
  if (await db.billing.isActiveSubscription(app.workspaceId)) {
    return { kind: 'error', code: 'already_active' }
  }

  const monthlyProductId = env.POLAR_MONTHLY_PRODUCT_ID ?? env.POLAR_PRODUCT_ID
  const productId = interval === 'yearly' ? env.POLAR_YEARLY_PRODUCT_ID : monthlyProductId
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

  // Prefer reusing an existing open Polar checkout for this workspace/product before creating another.
  if (listOpenCheckouts) {
    try {
      const openItems = await listOpenCheckouts({
        externalCustomerId: app.workspaceId,
        productId,
      })
      const existingUrl = pickReusableOpenCheckoutUrl(openItems)
      if (existingUrl) return { kind: 'ok', url: existingUrl }
    } catch (error) {
      console.error('polar open checkout list failed', error)
    }
  }

  try {
    const session = await createCheckout(
      {
        products: [productId],
        successUrl: `${env.APP_URL}/dashboard?ok=billing_success&checkout_id={CHECKOUT_ID}`,
        returnUrl: `${env.APP_URL}/dashboard/billing?error=unknown`,
        externalCustomerId: app.workspaceId,
        customerEmail: app.user.email,
        customerName: app.user.name,
        metadata: { workspaceId: app.workspaceId },
        customerMetadata: { workspaceId: app.workspaceId },
      },
      { headers: { 'Idempotency-Key': checkoutIdempotencyKey(app.workspaceId, interval) } },
    )
    if (!session.url) return { kind: 'error', code: 'checkout_failed' }
    return { kind: 'ok', url: session.url }
  } catch (error) {
    console.error('polar checkout failed', error)
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
  const sourceTimestamp =
    epochSeconds(data.updatedAt ?? data.updated_at) ??
    epochSeconds(data.createdAt ?? data.created_at) ??
    Math.floor(Date.now() / 1000)
  const eventId = await polarEventId(event, payload, request.headers)
  const subscriptionId =
    stringField(data, 'subscriptionId', 'subscription_id') ??
    (typeof data.id === 'string' && event.type.startsWith('subscription.') ? data.id : null)
  const result = await applyPolarWebhookAtomically(env.DB, {
    eventId,
    workspaceId,
    eventType: event.type,
    sourceTimestamp,
    appliedStatus: status,
    polarCustomerId: stringField(data, 'customerId', 'customer_id') ?? null,
    polarSubscriptionId: subscriptionId,
    currentPeriodEnd: epochSeconds(data.currentPeriodEnd ?? data.current_period_end) ?? null,
  })
  return Response.json({ received: true, result: result.kind })
}
