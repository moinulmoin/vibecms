import { env } from "cloudflare:workers";

export function invalidApiKeyMessage() {
  const keysUrl = new URL("/dashboard/connect", env.APP_URL).href;
  return `This API key is invalid or was deleted. Create a new key in the vibecms dashboard: ${keysUrl}.`;
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
