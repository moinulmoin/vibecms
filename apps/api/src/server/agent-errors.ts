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
 * Keep recovery links in the text agents read as well as structured error details.
 * Only free-plan limits get the upgrade link: RATE_LIMIT and media_quota_paid also
 * reach paying Cloud customers, where "upgrade" would be wrong.
 */
export function agentErrorDetails(code: string, message: string, details?: unknown) {
  if (!["BILLING_REQUIRED", "ANALYTICS_PAID_PLAN", "billing_required", "media_quota_free"].includes(code)) {
    return { message, details };
  }
  const upgradeUrl = new URL("/dashboard/settings?tab=billing", env.APP_URL).href;
  return {
    message: `${message} Upgrade to vibecms Cloud: ${upgradeUrl}`,
    details: {
      ...(details && typeof details === "object" && !Array.isArray(details) ? details : {}),
      upgradeUrl,
    },
  };
}
