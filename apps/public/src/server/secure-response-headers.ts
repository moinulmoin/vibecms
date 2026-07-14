export type PublicPageKind = "html" | "feed" | "media" | "api";

export function classifyPublicPath(pathname: string): PublicPageKind {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/media-assets/")) return "media";
  if (path === "/api/subscribe") return "api";
  if (
    path === "/feed.xml" ||
    path === "/sitemap.xml" ||
    path === "/robots.txt" ||
    path === "/llms.txt" ||
    path === "/__vc-health"
  ) {
    return "feed";
  }
  return "html";
}

/** Baseline headers for every public Worker response. */
export function applyBaselineSecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
}

/**
 * Frame and navigation restrictions that must be delivered as response headers.
 * Astro owns script/style CSP because it hashes generated island hydration code.
 */
export function buildHtmlContentSecurityPolicy(): string {
  return [
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

export function applyPublicSecurityHeaders(
  pathname: string,
  contentType: string | null,
  headers: Headers,
): void {
  applyBaselineSecurityHeaders(headers);

  const kind = classifyPublicPath(pathname);
  if (kind === "media") {
    return;
  }

  if (kind === "feed" || kind === "api") {
    headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    return;
  }

  const isHtml = (contentType ?? "").toLowerCase().includes("text/html");
  if (isHtml || kind === "html") {
    headers.set("Content-Security-Policy", buildHtmlContentSecurityPolicy());
  }
}