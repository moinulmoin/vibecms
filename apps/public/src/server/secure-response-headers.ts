import type { PublicLocation } from "./public-location";

export type PublicPageKind = "html" | "feed" | "media" | "api";

export function classifyPublicPath(pathname: string): PublicPageKind {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/media-assets/")) return "media";
  // Generated share cards (PNG) behave like media.
  if (path === "/og.png" || path.startsWith("/og/")) return "media";
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
export function buildHtmlContentSecurityPolicy(formOrigin?: string): string {
  return [
    "base-uri 'self'",
    `form-action 'self'${formOrigin ? ` ${formOrigin}` : ""}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Astro hashes its own inline <style> blocks into style-src. Any hash or nonce
 * makes browsers ignore 'unsafe-inline', which silently blocks every style=""
 * attribute: blog themes (accent, fonts, width) and landing gradients. When the
 * config allows inline styles, drop the hashes so it actually applies.
 * Scripts are untouched.
 */
function allowInlineStyles(policy: string): string {
  return policy
    .split(";")
    .map((directive) => {
      const tokens = directive.trim().split(/\s+/);
      if (tokens[0]?.toLowerCase() !== "style-src" || !tokens.includes("'unsafe-inline'")) return directive.trim();
      return tokens.filter((t) => !/^'(sha(256|384|512)-|nonce-)/i.test(t)).join(" ");
    })
    .filter(Boolean)
    .join("; ");
}

/**
 * Proxied subpath pages (plan 022 §5) load hashed assets from our host: the
 * rewriter absolutizes `/_astro/*`, media, OG and root icons onto
 * `assetOrigin`, so every resource directive must list it. `connect-src`
 * stays `'self'`; form-action is scoped separately to the site's newsletter.
 * Missing directives fall back to `default-src`, so the extra directives are
 * seeded from it when the merged policy has one.
 */
const ASSET_ORIGIN_DIRECTIVES: Record<string, true> = {
  "script-src": true,
  "style-src": true,
  "font-src": true,
  "img-src": true,
  "manifest-src": true,
};

function trustAssetOrigin(policy: string, assetOrigin: string): string {
  const directives = policy.split(";").map((d) => d.trim()).filter(Boolean);
  const fallback = directives.find((d) => d.toLowerCase().startsWith("default-src"));
  const names = new Set(directives.map((d) => d.split(/\s+/, 1)[0]!.toLowerCase()));
  for (const [i, directive] of directives.entries()) {
    const name = directive.split(/\s+/, 1)[0]!.toLowerCase();
    if (ASSET_ORIGIN_DIRECTIVES[name] && !directive.split(/\s+/).includes(assetOrigin)) {
      directives[i] = `${directive} ${assetOrigin}`;
    }
  }
  if (fallback) {
    for (const name in ASSET_ORIGIN_DIRECTIVES) {
      if (!names.has(name)) directives.push(`${name}${fallback.slice(fallback.indexOf(" "))} ${assetOrigin}`);
    }
  }
  return directives.join("; ");
}

/**
 * Keep Astro's script/style policy (it hashes its own inline code) and add the
 * frame/navigation directives. Without an Astro policy, scripts are still
 * limited to this origin: tenant pages render untrusted Markdown.
 */
export function mergeHtmlContentSecurityPolicy(astroPolicy: string | null, location?: Pick<PublicLocation, "assetOrigin" | "proxied">, formOrigin?: string): string {
  const ours = buildHtmlContentSecurityPolicy(formOrigin);
  const existing = allowInlineStyles((astroPolicy ?? "").trim().replace(/;\s*$/, ""));
  let merged: string;
  if (!existing) {
    merged = `script-src 'self'; ${ours}`;
  } else {
    const names = new Set(existing.split(";").map((d) => d.trim().split(/\s+/)[0]?.toLowerCase()));
    const extra = ours.split("; ").filter((d) => !names.has(d.split(" ")[0]!.toLowerCase()));
    merged = extra.length ? `${existing}; ${extra.join("; ")}` : existing;
  }
  if (formOrigin) {
    merged = merged.split(";").map((directive) =>
      directive.trim().toLowerCase().startsWith("form-action ")
        ? `form-action 'self' ${formOrigin}`
        : directive.trim(),
    ).join("; ");
  }
  return location?.proxied && location.assetOrigin ? trustAssetOrigin(merged, location.assetOrigin) : merged;
}

export function applyPublicSecurityHeaders(
  pathname: string,
  contentType: string | null,
  headers: Headers,
  location?: Pick<PublicLocation, "assetOrigin" | "proxied">,
  formOrigin?: string,
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
    headers.set("Content-Security-Policy", mergeHtmlContentSecurityPolicy(headers.get("Content-Security-Policy"), location, formOrigin));
  }
}