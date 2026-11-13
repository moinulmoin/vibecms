import { env } from "cloudflare:workers";

export function invalidApiKeyMessage() {
  const keysUrl = new URL("/dashboard/connect", env.APP_URL).href;
  return `This key or sign-in is invalid, expired or was removed. Sign in again, or create a new agent key in the vibecms dashboard: ${keysUrl}.`;
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

/**
 * Keep the plans link in the text agents read as well as structured error
 * details, and tell the agent to hand the limit to the owner instead of
 * retrying a call that cannot succeed. Only free-plan limits get it:
 * RATE_LIMIT and media_quota_paid also reach paying Cloud customers.
 */
export function agentErrorDetails(code: string, message: string, details?: unknown) {
  if (!["BILLING_REQUIRED", "ANALYTICS_PAID_PLAN", "billing_required", "media_quota_free"].includes(code)) {
    return { message, details };
  }
  const url = plansUrl();
  return {
    message: `${message} Do not retry; tell the blog owner. Plans: ${url}`,
    details: {
      ...(details && typeof details === "object" && !Array.isArray(details) ? details : {}),
      plansUrl: url,
    },
  };
}
