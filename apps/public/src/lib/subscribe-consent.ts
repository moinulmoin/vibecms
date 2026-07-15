// Visible subscribe copy AND the consent record stored with each subscriber.
// Client-safe (no server / cloudflare:workers imports) so the public 'use client'
// form, the server handler, and the tests share one source of truth. Bumping
// SUBSCRIBE_CONSENT_VERSION means the consent language changed and new
// subscribers must be stamped with the new version.
export const SUBSCRIBE_HEADING = "Get new posts by email";
export const SUBSCRIBE_SUBTEXT =
  "Email delivery is coming soon. Join now and we'll let you know when it launches.";
export const SUBSCRIBE_BUTTON = "Notify me";
export const SUBSCRIBE_SUCCESS =
  "You're on the list. We'll email you when subscriptions launch.";

// Consent copy shown in the subscribe widget AND stored with each subscriber.
export const SUBSCRIBE_CONSENT_TEXT =
  "By subscribing, you agree to receive one email when subscriptions launch. No marketing emails.";

export const SUBSCRIBE_CONSENT_VERSION = "2";
