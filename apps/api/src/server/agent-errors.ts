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
 * Keep the plans link in the text agents read as well as structured error
 * details. It points at the public pricing section, never a checkout: agent
 * directories (ChatGPT, Claude) forbid tools that start upgrades. Only
 * free-plan limits get it: RATE_LIMIT and media_quota_paid also reach paying
 * Cloud customers.
 */
export function agentErrorDetails(code: string, message: string, details?: unknown) {
  if (!["BILLING_REQUIRED", "ANALYTICS_PAID_PLAN", "billing_required", "media_quota_free"].includes(code)) {
    return { message, details };
  }
  const plansUrl = `https://${env.PUBLIC_BLOG_DOMAIN}/#pricing`;
  return {
    message: `${message} Plans: ${plansUrl}`,
    details: {
      ...(details && typeof details === "object" && !Array.isArray(details) ? details : {}),
      plansUrl,
    },
  };
}
