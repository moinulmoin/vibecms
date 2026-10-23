import { Buffer } from 'node:buffer'
import { Webhook } from 'standardwebhooks'
import { WebhookBenefitCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookbenefitcreatedpayload.js'
import { WebhookBenefitGrantCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookbenefitgrantcreatedpayload.js'
import { WebhookBenefitGrantRevokedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookbenefitgrantrevokedpayload.js'
import { WebhookBenefitGrantUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookbenefitgrantupdatedpayload.js'
import { WebhookBenefitGrantCycledPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookbenefitgrantcycledpayload.js'
import { WebhookBenefitUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookbenefitupdatedpayload.js'
import { WebhookCheckoutCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcheckoutcreatedpayload.js'
import { WebhookCheckoutUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcheckoutupdatedpayload.js'
import { WebhookOrderCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookordercreatedpayload.js'
import { WebhookOrderRefundedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookorderrefundedpayload.js'
import { WebhookOrderUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookorderupdatedpayload.js'
import { WebhookOrderPaidPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookorderpaidpayload.js'
import { WebhookOrganizationUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookorganizationupdatedpayload.js'
import { WebhookProductCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookproductcreatedpayload.js'
import { WebhookProductUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookproductupdatedpayload.js'
import { WebhookRefundCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookrefundcreatedpayload.js'
import { WebhookRefundUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookrefundupdatedpayload.js'
import { WebhookSubscriptionActivePayload$inboundSchema } from '@polar-sh/sdk/models/components/webhooksubscriptionactivepayload.js'
import { WebhookSubscriptionCanceledPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhooksubscriptioncanceledpayload.js'
import { WebhookSubscriptionCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhooksubscriptioncreatedpayload.js'
import { WebhookSubscriptionRevokedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhooksubscriptionrevokedpayload.js'
import { WebhookSubscriptionUncanceledPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhooksubscriptionuncanceledpayload.js'
import { WebhookSubscriptionUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhooksubscriptionupdatedpayload.js'
import { WebhookCustomerCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcustomercreatedpayload.js'
import { WebhookCustomerUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcustomerupdatedpayload.js'
import { WebhookCustomerDeletedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcustomerdeletedpayload.js'
import { WebhookCustomerStateChangedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcustomerstatechangedpayload.js'
import { WebhookCustomerSeatAssignedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcustomerseatassignedpayload.js'
import { WebhookCustomerSeatClaimedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcustomerseatclaimedpayload.js'
import { WebhookCustomerSeatRevokedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcustomerseatrevokedpayload.js'
import { WebhookMemberCreatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookmembercreatedpayload.js'
import { WebhookMemberUpdatedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookmemberupdatedpayload.js'
import { WebhookMemberDeletedPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookmemberdeletedpayload.js'
import { WebhookCheckoutExpiredPayload$inboundSchema } from '@polar-sh/sdk/models/components/webhookcheckoutexpiredpayload.js'
import { WebhookSubscriptionPastDuePayload$inboundSchema } from '@polar-sh/sdk/models/components/webhooksubscriptionpastduepayload.js'
import { SDKValidationError } from '@polar-sh/sdk/models/errors/sdkvalidationerror.js'

function parseEvent(parsed: { type: string }) {
  try {
    switch (parsed.type) {
      case "customer.created":
        return WebhookCustomerCreatedPayload$inboundSchema.parse(parsed);
      case "customer.updated":
        return WebhookCustomerUpdatedPayload$inboundSchema.parse(parsed);
      case "customer.deleted":
        return WebhookCustomerDeletedPayload$inboundSchema.parse(parsed);
      case "customer.state_changed":
        return WebhookCustomerStateChangedPayload$inboundSchema.parse(parsed);
      case "customer_seat.assigned":
        return WebhookCustomerSeatAssignedPayload$inboundSchema.parse(parsed);
      case "customer_seat.claimed":
        return WebhookCustomerSeatClaimedPayload$inboundSchema.parse(parsed);
      case "customer_seat.revoked":
        return WebhookCustomerSeatRevokedPayload$inboundSchema.parse(parsed);
      case "member.created":
        return WebhookMemberCreatedPayload$inboundSchema.parse(parsed);
      case "member.updated":
        return WebhookMemberUpdatedPayload$inboundSchema.parse(parsed);
      case "member.deleted":
        return WebhookMemberDeletedPayload$inboundSchema.parse(parsed);
      case "benefit.created":
        return WebhookBenefitCreatedPayload$inboundSchema.parse(parsed);
      case "benefit_grant.created":
        return WebhookBenefitGrantCreatedPayload$inboundSchema.parse(parsed);
      case "benefit_grant.cycled":
        return WebhookBenefitGrantCycledPayload$inboundSchema.parse(parsed);
      case "benefit_grant.revoked":
        return WebhookBenefitGrantRevokedPayload$inboundSchema.parse(parsed);
      case "benefit_grant.updated":
        return WebhookBenefitGrantUpdatedPayload$inboundSchema.parse(parsed);
      case "benefit.updated":
        return WebhookBenefitUpdatedPayload$inboundSchema.parse(parsed);
      case "checkout.created":
        return WebhookCheckoutCreatedPayload$inboundSchema.parse(parsed);
      case "checkout.updated":
        return WebhookCheckoutUpdatedPayload$inboundSchema.parse(parsed);
      case "checkout.expired":
        return WebhookCheckoutExpiredPayload$inboundSchema.parse(parsed);
      case "order.created":
        return WebhookOrderCreatedPayload$inboundSchema.parse(parsed);
      case "order.paid":
        return WebhookOrderPaidPayload$inboundSchema.parse(parsed);
      case "order.updated":
        return WebhookOrderUpdatedPayload$inboundSchema.parse(parsed);
      case "order.refunded":
        return WebhookOrderRefundedPayload$inboundSchema.parse(parsed);
      case "organization.updated":
        return WebhookOrganizationUpdatedPayload$inboundSchema.parse(parsed);
      case "product.created":
        return WebhookProductCreatedPayload$inboundSchema.parse(parsed);
      case "product.updated":
        return WebhookProductUpdatedPayload$inboundSchema.parse(parsed);
      case "refund.created":
        return WebhookRefundCreatedPayload$inboundSchema.parse(parsed);
      case "refund.updated":
        return WebhookRefundUpdatedPayload$inboundSchema.parse(parsed);
      case "subscription.active":
        return WebhookSubscriptionActivePayload$inboundSchema.parse(parsed);
      case "subscription.canceled":
        return WebhookSubscriptionCanceledPayload$inboundSchema.parse(parsed);
      case "subscription.created":
        return WebhookSubscriptionCreatedPayload$inboundSchema.parse(parsed);
      case "subscription.revoked":
        return WebhookSubscriptionRevokedPayload$inboundSchema.parse(parsed);
      case "subscription.uncanceled":
        return WebhookSubscriptionUncanceledPayload$inboundSchema.parse(parsed);
      case "subscription.updated":
        return WebhookSubscriptionUpdatedPayload$inboundSchema.parse(parsed);
      case "subscription.past_due":
        return WebhookSubscriptionPastDuePayload$inboundSchema.parse(parsed);
      default:
        throw new SDKValidationError(
          `Unknown event type: ${parsed.type}`,
          parsed.type,
          parsed,
        );
    }
  } catch (error) {
    throw new SDKValidationError("Failed to parse event", error, parsed);
  }
}

/** Both Polar generations can start with whsec_; the prefix is an ordering hint only. */
export function validatePolarWebhook(body: string, headers: Record<string, string>, secret: string) {
  const legacySecret = Buffer.from(secret, 'utf-8').toString('base64')
  // The Standard Webhooks key is the base64 after `whsec_`. A secret saved as a bare
  // `whsec_` would decode to an empty HMAC key that anyone can sign with: never try it.
  const standard = Buffer.from(secret.replace(/^whsec_/, ''), 'base64').length > 0 ? [secret] : []
  const keys = secret.startsWith('whsec_') ? [...standard, legacySecret] : [legacySecret, ...standard]
  let verified: { type: string } | undefined
  for (const key of keys) {
    try {
      verified = new Webhook(key).verify(body, headers) as { type: string }
      break
    } catch {
      // Try the other documented key encoding without exposing credentials or signatures.
    }
  }
  if (!verified) throw new Error('Invalid webhook signature')
  // Parse once, outside the verification fallback: a schema error is not a key mismatch.
  return parseEvent(verified)
}
