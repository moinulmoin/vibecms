// Consent copy shown in the subscribe widget AND stored with each subscriber.
// Client-safe (no server / cloudflare:workers imports) so the public 'use client'
// form and the server handler can share one source of truth.
export const SUBSCRIBE_CONSENT_TEXT =
  'By subscribing, you agree to receive one email when subscriptions launch. No marketing emails.'

export const SUBSCRIBE_CONSENT_VERSION = '2'
