import { env } from "cloudflare:workers";
import { SITE_SUSPENDED_MESSAGE } from "@vc/config";

export function invalidApiKeyMessage() {
  const keysUrl = new URL("/dashboard/connect", env.APP_URL).href;
  return `This key or sign-in is invalid, expired or was removed. Sign in again, or ask the blog owner for a new agent key from the vibecms dashboard: ${keysUrl}.`;
}

/** MCP requests without any credential: the first contact of every new connection. */
export function signInRequiredMessage() {
  const keysUrl = new URL("/dashboard/connect", env.APP_URL).href;
  return `Sign in required. Connect vibecms in your agent to sign in, or use an agent key from the vibecms dashboard: ${keysUrl}.`;
}

/**
 * The upgrade link agents pass on: the public pricing section, never a
 * checkout, because agent directories (ChatGPT, Claude) forbid tools that
 * start upgrades.
 */
export function plansUrl() {
  return `https://${env.PUBLIC_BLOG_DOMAIN}/#pricing`;
}

/** Free-plan limits: the owner can lift them, so the agent gets the plans link. */
const FREE_LIMIT_CODES = ["BILLING_REQUIRED", "ANALYTICS_PAID_PLAN", "billing_required", "media_quota_free"];

/**
 * Refusals a retry cannot fix that also reach paying Cloud customers, so no
 * plans link: a full 10 GB media library, and a blog an operator suspended.
 */
const OWNER_ONLY_CODES = ["media_quota_paid"];

/**
 * Tell the agent to hand a refusal to the owner instead of retrying a call
 * that cannot succeed. Free-plan limits also carry the plans link in the text
 * agents read and in structured error details. RATE_LIMIT is not here: it
 * clears by waiting.
 */
export function agentErrorDetails(code: string, message: string, details?: unknown) {
  if (OWNER_ONLY_CODES.includes(code) || (code === "FORBIDDEN" && message === SITE_SUSPENDED_MESSAGE)) {
    return { message: `${message} Do not retry; tell the blog owner.`, details };
  }
  if (!FREE_LIMIT_CODES.includes(code)) {
    return { message, details };
  }
  const url = plansUrl();
  return {
    message: `${message} Do not retry; tell the blog owner, who can change plans in the vibecms dashboard. Plans: ${url}`,
    details: {
      ...(details && typeof details === "object" && !Array.isArray(details) ? details : {}),
      plansUrl: url,
    },
  };
}
