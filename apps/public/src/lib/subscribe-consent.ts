// Visible subscribe copy lives in @vc/content (shared with the dashboard
// editor preview's inert subscribe block); this module re-exports it and owns
// the consent RECORD version stored with each subscriber. Bumping
// SUBSCRIBE_CONSENT_VERSION means the consent language changed and new
// subscribers must be stamped with the new version.
export {
  SUBSCRIBE_HEADING,
  SUBSCRIBE_SUBTEXT,
  SUBSCRIBE_BUTTON,
  SUBSCRIBE_SUCCESS,
  SUBSCRIBE_CONSENT_TEXT,
} from "@vc/content/public-chrome";

export const SUBSCRIBE_CONSENT_VERSION = "2";
