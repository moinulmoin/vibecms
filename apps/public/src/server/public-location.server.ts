/**
 * Request-time location resolution for the public Worker (plans/022):
 * proxy ingress (`/_vc/p/<proxyId>/<rest>`), the `/_vc/health` probe, and
 * primary-location canonical redirects. Kept middleware-free (no
 * `astro:middleware`) so worker tests can exercise it directly.
 */
import { proxyFingerprint } from "@vc/core";
import { createDataAccess } from "@vc/db";
import type { PublicRuntimeEnv } from "../env";
import { proxiedLocation, type PublicLocation } from "./public-location";
import { isMarketingHost } from "./public-blog-data";

// `/_vc/p/<proxyId>/<rest>` — how customer proxies forward customer.com/blog/*.
// The id is long enough to stay non-guessable but is not a secret.
const PROXY_INGRESS_RE = /^\/_vc\/p\/([A-Za-z0-9_-]{16,64})(\/.*)?$/;

// Paths served from our host even for proxied blogs (assets, previews, beacons,
// health) never participate in primary-location redirects.
const PRIMARY_REDIRECT_EXEMPT_RE = /^\/(?:_vc(?:\/|$)|_astro(?:\/|$)|internal(?:\/|$)|media-assets(?:\/|$)|og(?:[./]|$)|api(?:\/|$)|preview(?:\/|$)|favicon\.|__vc-health)/;

function hostHeader(request: Request): string {
  return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
}

export type PublicLocationIngress =
  | { kind: "direct" }
  | { kind: "proxied"; location: PublicLocation; path: string }
  | { kind: "health"; siteId: string | null; proxyFingerprint: string | null }
  /** Valid proxy id on a not-yet-active row: health answers, pages get the setup 404. */
  | { kind: "not-connected" }
  | { kind: "not-found" };

/**
 * Effective hosted entitlement for a site row (same rule `resolveSite` uses to
 * gate custom domains; self-host is always entitled). Null/!effective means
 * the paid locations (custom domain, subpath mount) must not serve or be
 * redirected to.
 */
async function hostedEntitled(
  db: D1Database,
  siteId: string,
  env: PublicRuntimeEnv,
): Promise<boolean> {
  if (env.selfHosted) return true;
  const entitlement = await createDataAccess(db).managedSites.resolveSite(siteId, {
    selfHosted: false,
    // Unfloored epoch seconds: the past_due grace deadline is exact to the millisecond.
    now: Date.now() / 1000,
  });
  return entitlement?.effective ?? false;
}

/**
 * Match the path, resolve the subpath row by proxy id (any status — the row
 * must exist so `/_vc/health` can verify pending setup), and check it belongs
 * to the site resolved from the Host header. Unknown ids, ids quoted on the
 * wrong host, and ids on unentitled sites are `not-found` — never render a
 * page. A non-active row answers health but its pages are `not-connected`
 * until a setup check promotes it to active. Also handles `/_vc/health` in
 * both modes (proxied traffic arrives as `/_vc/p/<id>/_vc/health`).
 */
// Re-exported for tests; the implementation lives in @vc/core (the API's
// setup check computes the same fingerprint).
export { proxyFingerprint };
export async function resolvePublicLocationIngress(
  db: D1Database,
  request: Request,
  pathname: string,
  env: PublicRuntimeEnv,
): Promise<PublicLocationIngress> {
  const data = createDataAccess(db);
  const host = hostHeader(request);
  const ingress = PROXY_INGRESS_RE.exec(pathname);
  if (!ingress) {
    if (pathname !== "/_vc/health") return { kind: "direct" };
    const site = host ? await data.publicBlog.resolveSiteByHost(host) : null;
    return { kind: "health", siteId: site?.id ?? null, proxyFingerprint: null };
  }

  const proxyId = ingress[1]!;
  const [site, subpath] = await Promise.all([
    host ? data.publicBlog.resolveSiteByHost(host) : Promise.resolve(null),
    data.publicBlog.resolveSubpathByProxyId(proxyId),
  ]);
  if (!site || !subpath || subpath.siteId !== site.id) return { kind: "not-found" };
  const path = ingress[2] || "/";
  if (path === "/_vc/health") return { kind: "health", siteId: site.id, proxyFingerprint: await proxyFingerprint(proxyId) };
  // A saved-but-unverified mount never serves pages: the dashboard check
  // verifies through health, then flips the row to active.
  if (subpath.status !== "active") return { kind: "not-connected" };
  // The subpath mount is a paid location: once the site's entitlement lapses
  // it stops serving even though `resolveSiteByHost` still resolves the
  // default host (free reads stay allowed there).
  if (!(await hostedEntitled(db, site.id, env))) return { kind: "not-found" };
  const location = proxiedLocation(subpath, request);
  return { kind: "proxied", location, path };
}

/**
 * What an `/internal/*` rewrite pass should resolve to. `pages/index.astro`
 * rewrites `/` to `/internal/tenant…`; Astro reruns middleware on the
 * rewritten request but keeps `context.locals`, so the ingress result from
 * the first pass is still there. Reusing it keeps the proxied location and
 * the blog-relative public path — without this the second pass would treat
 * `/internal/tenant` as a direct non-primary request and 301 it.
 */
export function ingressStateForPass(
  locals: { publicLocation?: PublicLocation; publicPath?: string },
): { location: PublicLocation; publicPath: string } | null {
  if (!locals.publicLocation || locals.publicPath === undefined) return null;
  return { location: locals.publicLocation, publicPath: locals.publicPath };
}

/**
 * Primary-location canonicalization (plan 022 §4): a hosted site answered on a
 * non-primary host (its default host while a custom domain or subpath is the
 * canonical mount) 301s to the same page at the primary location. Covers HTML
 * pages and feeds alike. Proxied requests already ARE the primary location;
 * self-hosted has no canon; marketing hosts and infra paths are exempt.
 */
export async function primaryLocationRedirect(
  db: D1Database,
  request: Request,
  pathname: string,
  env: PublicRuntimeEnv,
  location: PublicLocation,
): Promise<Response | null> {
  if (location.proxied) return null;
  if (env.selfHosted) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (PRIMARY_REDIRECT_EXEMPT_RE.test(pathname)) return null;
  if (isMarketingHost(request, env)) return null;
  const host = hostHeader(request);
  const site = host ? await createDataAccess(db).publicBlog.resolveSiteByHost(host) : null;
  const primary = site?.primaryLocation;
  if (!primary) return null;
  // Paid mounts (custom domain, subpath) are only canonical while the site is
  // entitled; an unentitled site keeps serving its default host instead of
  // 301ing readers at a location that 404s.
  if (primary.type !== "default" && !(await hostedEntitled(db, site.id, env))) return null;
  if (primary.hostname.toLowerCase() === host && primary.basePath === "") return null;
  const target = `https://${primary.hostname}${primary.basePath}${pathname}${new URL(request.url).search}`;
  return new Response(null, {
    status: 301,
    // The destination depends on the site's entitlement; `no-cache` forces
    // revalidation on reuse so an expiry never strands readers on a cached
    // redirect to a mount that now 404s.
    headers: { location: target, "cache-control": "no-cache" },
  });
}
