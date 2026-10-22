import { LEGAL } from "@vc/config";

type LegalPage = keyof typeof LEGAL;

/**
 * Last substantive revision of each legal page (ISO date). The single source
 * for the page's "Last updated" line and the marketing sitemap's `<lastmod>`.
 */
export const LEGAL_UPDATED = {
  privacy: "2026-10-22",
  terms: "2026-10-22",
  support: "2026-08-16",
} as const satisfies Record<LegalPage, string>;

/** "2026-10-15" -> "October 15, 2026" for the page's "Last updated" line. */
export function legalUpdatedLabel(page: LegalPage): string {
  return new Date(`${LEGAL_UPDATED[page]}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Legal pages for the marketing sitemap, in nav order. */
export const legalSitemapPages = (Object.keys(LEGAL_UPDATED) as LegalPage[]).map((page) => ({
  path: LEGAL[page],
  lastmod: LEGAL_UPDATED[page],
}));
