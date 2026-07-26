/** Path prefix for rewrite-only root module graphs (marketing vs tenant). */
export const INTERNAL_ROOT_PREFIX = "/internal";

/**
 * True when the request is a direct hit on an internal rewrite target rather
 * than a rewrite from the external `/` root. Direct hits must 404 so internal
 * paths stay non-indexable and never become canonical URLs.
 */
export function isDirectInternalRootHit(originPathname: string, rewrittenPathname: string): boolean {
  if (originPathname.startsWith(`${INTERNAL_ROOT_PREFIX}/`) || originPathname === INTERNAL_ROOT_PREFIX) {
    return true;
  }
  return originPathname === rewrittenPathname;
}
