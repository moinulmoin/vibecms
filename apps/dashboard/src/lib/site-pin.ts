// The site this tab loaded with. Writes carry it (x-vc-expected-site) and
// tenant query keys use it, so a selection change in another tab can neither
// retarget this tab's writes nor re-key its mounted pages.
let pinnedSiteId: string | null = null

export function pinnedDashboardSiteId() {
  return pinnedSiteId
}

/** First load pins; later background refreshes must not move the pin. */
export function pinDashboardSiteOnce(siteId: string | null | undefined) {
  if (!pinnedSiteId) pinnedSiteId = siteId ?? null
}

/** This tab's own switch moves the pin before its full navigation. */
export function repinDashboardSite(siteId: string) {
  pinnedSiteId = siteId
}
