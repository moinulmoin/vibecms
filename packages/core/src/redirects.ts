import { RESERVED_POST_SLUGS } from "@vc/config";

/** Root routes that cannot be claimed as old-link redirect sources. */
export const RESERVED_ROOT_SLUGS = new Set<string>([
  ...RESERVED_POST_SLUGS,
  "tag", "preview", "legal", "og", "og.png", ".well-known", "_astro", "_vc",
  "openapi.json", "auth.md",
]);

/** Normalize a blog-relative path. Invalid paths return null. */
export function normalizeRedirectPath(
  path: string,
  options: { preserveCase?: boolean; allowRoot?: boolean } = {},
): string | null {
  if (!path.startsWith("/") || path.length > 512 || /[?#\\\u0000-\u001f\u007f]/.test(path)) return null;
  try {
    const segments = path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) => segment === "." || segment === ".." || /[/\\?#\u0000-\u001f\u007f]/.test(segment))) return null;
    const decoded = `/${segments.join("/")}`;
    const normalized = options.preserveCase ? decoded : decoded.toLowerCase();
    if (normalized.length > 512 || (normalized === "/" && !options.allowRoot)) return null;
    return normalized;
  } catch {
    return null;
  }
}
