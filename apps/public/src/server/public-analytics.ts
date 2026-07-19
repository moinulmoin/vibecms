export const ANALYTICS_RETENTION_DAYS = 90;

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
