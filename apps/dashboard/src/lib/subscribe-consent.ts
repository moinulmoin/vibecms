// Consent copy shown in the subscribe widget AND stored with each subscriber.
// Client-safe (no server / cloudflare:workers imports) so the public 'use client'
// form and the server handler can share one source of truth.
export const SUBSCRIBE_CONSENT_TEXT =
  'By submitting your email you agree to receive a notification when email delivery launches. No marketing emails.'

export const SUBSCRIBE_CONSENT_VERSION = '1'
