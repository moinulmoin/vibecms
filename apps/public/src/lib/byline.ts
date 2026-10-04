/**
 * Public byline for a published post. Pure (no worker imports) so the article
 * templates, the OG card, and unit tests all resolve it the same way.
 *
 * - `name`: the owner's chosen public name (`sites.byline_name`, trimmed), or
 *   the site name when unset. The account email is never a fallback.
 *
 * Agent credit ("Agent-written · Reviewed by …") is off until agent profiles
 * have a proper design; posts show the author only. The stored setting stays.
 */
import { BYLINE_NAME_MAX_LENGTH } from "@vc/config";

export type PublicByline = { name: string };

export type BylineSiteInput = {
  name: string;
  byline_name?: string | null;
  show_agent_credit?: boolean | null;
};

export type BylinePostInput = {
  published_by_agent?: boolean | null;
};

export function resolveBylineName(site: BylineSiteInput): string {
  return site.byline_name?.trim().slice(0, BYLINE_NAME_MAX_LENGTH) || site.name;
}

export function resolvePublicByline(site: BylineSiteInput, _post: BylinePostInput | null): PublicByline {
  return { name: resolveBylineName(site) };
}
