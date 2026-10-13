export const ANALYTICS_RETENTION_DAYS = 90;

/**
 * Self-host analytics gate (plans/023 §5): collection + rollup turn on when
 * the install provides the ANALYTICS binding and the three query vars the API
 * Worker needs to read the dataset back.
 */
export function analyticsConfigured(raw: Env): boolean {
  const vars = raw as unknown as {
    ANALYTICS?: AnalyticsEngineDataset;
    ANALYTICS_ACCOUNT_ID?: string;
    ANALYTICS_DATASET?: string;
    ANALYTICS_API_TOKEN?: string;
  };
  return Boolean(
    vars.ANALYTICS &&
      vars.ANALYTICS_ACCOUNT_ID?.trim() &&
      vars.ANALYTICS_DATASET?.trim() &&
      vars.ANALYTICS_API_TOKEN?.trim(),
  );
}

export type PageViewEvent = {
  siteId: string;
  postId: string;
  postSlug: string;
  referrerHost: string | null;
};

export function normalizeReferrerHost(value: unknown, currentHost: string): string | null {
  if (typeof value !== "string" || value.length > 255) return null;
  const candidate = value.trim().toLowerCase();
  if (!candidate) return null;
  try {
    const hostname = new URL(`https://${candidate}`).hostname;
    if (hostname !== candidate || hostname === currentHost.toLowerCase()) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function privacySignalEnabled(request: Request): boolean {
  const dnt = request.headers.get("dnt")?.toLowerCase();
  return dnt === "1" || dnt === "yes" || request.headers.get("sec-gpc") === "1";
}

export function writePageView(dataset: AnalyticsEngineDataset, event: PageViewEvent): void {
  dataset.writeDataPoint({
    indexes: [event.siteId],
    blobs: ["page_view", event.postId, event.postSlug, event.referrerHost ?? ""],
    doubles: [1],
  });
}
