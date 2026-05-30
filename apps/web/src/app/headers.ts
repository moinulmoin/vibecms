import { RouteMiddleware } from "rwsdk/router";
import { env } from "cloudflare:workers";

type PublicBillingRow = { status: string | null; current_period_end: number | null };

function now() {
  return Math.floor(Date.now() / 1000);
}

async function shouldNoindexPublicBlog(request: Request) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const appHost = env.APP_URL ? new URL(env.APP_URL).host : "";
  if (!host || host === "localhost" || host.startsWith("app.") || host === appHost) return false;
  const row = await env.DB.prepare(
    `SELECT billing_customers.status, billing_customers.current_period_end
     FROM domains
     INNER JOIN sites ON sites.id = domains.site_id
     LEFT JOIN billing_customers ON billing_customers.workspace_id = sites.workspace_id
     WHERE domains.hostname = ? AND domains.status = 'active' AND sites.status = 'active'
     LIMIT 1`,
  ).bind(host).first<PublicBillingRow>();
  return row?.status === "trialing" && (!row.current_period_end || row.current_period_end >= now());
}

export const setCommonHeaders =
  (): RouteMiddleware =>
  async ({ request, response, rw: { nonce } }) => {
    if (!import.meta.env.VITE_IS_DEV_SERVER) {
      // Forces browsers to always use HTTPS for a specified time period (2 years)
      response.headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
      );
    }

    // Forces browser to use the declared content-type instead of trying to guess/sniff it
    response.headers.set("X-Content-Type-Options", "nosniff");

    // Stops browsers from sending the referring webpage URL in HTTP headers
    response.headers.set("Referrer-Policy", "no-referrer");

    // Explicitly disables access to specific browser features/APIs
    response.headers.set(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=()",
    );

    // Defines trusted sources for content loading and script execution:
    response.headers.set(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-eval' 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'self'; frame-src 'self' https://challenges.cloudflare.com; object-src 'none';`,
    );

    if (await shouldNoindexPublicBlog(request)) {
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
  };
