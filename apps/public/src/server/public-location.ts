/**
 * One "public location" per request (plans/022): the customer-facing origin and
 * base path every URL producer must use, plus the origin media/OG assets are
 * served from.
 *
 *   direct  (default/custom host): { origin: request origin, basePath: "",
 *            assetOrigin: request origin, proxied: false }
 *   proxied (customer.com/blog via /_vc/p/<proxyId>): { origin:
 *            "https://customer.com", basePath: "/blog",
 *            assetOrigin: request origin (our host), proxied: true }
 *
 * Computed once in middleware (public-location.server.ts) and put on
 * `Astro.locals.publicLocation`; non-Astro helpers receive it explicitly.
 */
import { publicOrigin } from "./public-url";

// Minimal projection the ingress needs; matches @vc/core's SubpathDomainRow
// (status is consumed by the resolver, which lives in the server module).
interface ProxiedDomain {
  hostname: string;
  basePath: string | null;
}

export interface PublicLocation {
  /** Customer-facing origin (absolute URLs: canonical, og:url, feeds). */
  origin: string;
  /** Path prefix on the customer host ("" or "/blog"); never "/". */
  basePath: string;
  /** Origin for media/OG image URLs (always our host for proxied requests). */
  assetOrigin: string;
  proxied: boolean;
}

export function directLocation(request: Request): PublicLocation {
  const origin = publicOrigin(request.url);
  return { origin, basePath: "", assetOrigin: origin, proxied: false };
}

export function proxiedLocation(domain: ProxiedDomain, request: Request): PublicLocation {
  return {
    origin: `https://${domain.hostname}`,
    basePath: domain.basePath ?? "",
    assetOrigin: publicOrigin(request.url),
    proxied: true,
  };
}

/** `location.origin + location.basePath` — the blog's public root URL (no trailing slash). */
export function publicBaseUrl(location: PublicLocation): string {
  return location.origin + location.basePath;
}

/** Same-origin href under the location: "/" maps to the location root. */
export function publicHref(location: PublicLocation, path: string): string {
  if (path === "/") return location.basePath || "/";
  return location.basePath + path;
}

/** Absolute customer-facing URL under the location. */
export function publicUrl(location: PublicLocation, path: string): string {
  return location.origin + publicHref(location, path);
}

/**
 * The request producers see in proxied mode: headers (Host!) come from the
 * real request, but the URL is rewritten to the customer-facing
 * `origin + basePath + path + ?search` so origin/canonical/cache-key
 * derivation needs no extra plumbing. Direct mode returns the request.
 */
export function publicLocationRequest(request: Request, location: PublicLocation | null | undefined, path: string): Request {
  if (!location?.proxied) return request;
  return new Request(publicUrl(location, path) + new URL(request.url).search, request);
}
