/**
 * Proxied subpath responses (plan 022 §5): the browser sits on
 * `customer.com/blog`, so root-relative URLs that name OUR Worker
 * (`/_astro/*`, media, OG images, root icon files) would be requested from
 * the customer's own site and 404. This pass rewrites those attribute values
 * to `assetOrigin + value`; the assets then load straight from our host.
 *
 * Everything else is left alone: blog links are already basePath-prefixed by
 * the producers, and root-relative links authors write in Markdown
 * (`/pricing`) deliberately point at the customer's own root.
 *
 * The rewriter runs over proxied HTML only — direct responses must stay
 * byte-identical, so call sites gate on `location.proxied`.
 */
import type { PublicLocation } from "./public-location";

// Static files served from the site's root that must come from our host.
// Keep in sync with `public/` — anything missed 404s on the customer domain.
const ROOT_ASSET_FILES: Record<string, true> = {
  "/favicon.svg": true,
  "/favicon.ico": true,
  "/favicon-16x16.png": true,
  "/favicon-32x32.png": true,
  "/favicon-96x96.png": true,
  "/apple-touch-icon.png": true,
  "/icon-192.png": true,
  "/icon-512.png": true,
  "/site.webmanifest": true,
};

const ASSET_PATH_PREFIXES = ["/_astro/", "/media-assets/", "/og/"];
/** Attribute names that may carry a URL which must point at our host. */
const URL_ATTRIBUTES: Record<string, true> = { src: true, href: true, poster: true };
const SRCSET_ATTRIBUTES: Record<string, true> = { srcset: true, imagesrcset: true };
/** `<meta content>` is a URL only for these image properties; titles and descriptions are text. */
const META_IMAGE_KEYS: Record<string, true> = {
  "og:image": true,
  "og:image:url": true,
  "og:image:secure_url": true,
  "twitter:image": true,
  "twitter:image:src": true,
};
/**
 * Root-relative URL naming one of our assets → absolute on the asset origin.
 * Classified on the normalized path (the browser resolves dot segments and
 * `%2e`), so `/_astro/../pricing` stays the customer's own `/pricing`.
 */
function rewriteUrl(value: string, assetOrigin: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return value;
  let path: string;
  try {
    path = new URL(value, "https://normalize.invalid").pathname;
  } catch {
    return value;
  }
  return ROOT_ASSET_FILES[path] || path === "/og.png" || ASSET_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
    ? assetOrigin + value
    : value;
}

/**
 * `srcset`/`imagesrcset` candidates, split the way the HTML spec does: a URL
 * runs to the next whitespace (commas inside it are part of the URL; trailing
 * commas end the candidate), then an optional descriptor up to the next
 * top-level comma.
 */
function rewriteSrcset(value: string, assetOrigin: string): string {
  let changed = false;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const lead = /^[\s,]*/.exec(value.slice(i))![0];
    out += lead;
    i += lead.length;
    if (i >= value.length) break;
    let url = /^\S+/.exec(value.slice(i))![0];
    i += url.length;
    let trailing = "";
    const commas = /,+$/.exec(url);
    if (commas) {
      trailing = commas[0];
      url = url.slice(0, -trailing.length);
    } else {
      const descriptor = /^[^,]*/.exec(value.slice(i))![0];
      trailing = descriptor;
      i += descriptor.length;
    }
    const rewritten = rewriteUrl(url, assetOrigin);
    if (rewritten !== url) changed = true;
    out += rewritten + trailing;
  }
  return changed ? out : value;
}

function isMetaImage(element: Element): boolean {
  const key = (element.getAttribute("property") ?? element.getAttribute("name") ?? "").toLowerCase();
  return META_IMAGE_KEYS[key] === true;
}

/**
 * `transform(response)` rewrites the asset attributes listed above to
 * `location.assetOrigin`. Font/module fetches are CORS-mode, so preloads and
 * module scripts pointing at our host get an explicit `crossorigin` (the
 * attribute means `anonymous` when given without a value).
 */
export function rewriteProxiedAssetsInHtml(response: Response, location: Pick<PublicLocation, "assetOrigin">): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) return response;
  const assetOrigin = location.assetOrigin;
  return new HTMLRewriter()
    .on("*", {
      element(element) {
        for (const [name, value] of [...(element.attributes as unknown as IterableIterator<string[]>)]) {
          // `data-*src` carriers count too (data-src, data-mermaid-src, …).
          const metaImage = name === "content" && element.tagName === "meta" && isMetaImage(element);
          if (!value || !(metaImage || URL_ATTRIBUTES[name] || SRCSET_ATTRIBUTES[name] || name.endsWith("src"))) continue;
          if (SRCSET_ATTRIBUTES[name]) {
            element.setAttribute(name, rewriteSrcset(value, assetOrigin));
          } else {
            element.setAttribute(name, rewriteUrl(value, assetOrigin));
          }
        }
        if (element.getAttribute("crossorigin") !== null) return;
        // CORS-mode fetches only: font/script preloads and module scripts.
        // (Stylesheets and images load without CORS; crossorigin there would
        // split the fetch and double-download.)
        const rel = element.getAttribute("rel")?.toLowerCase().split(/\s+/) ?? [];
        const as = element.getAttribute("as");
        const tag = element.tagName;
        if (tag === "link" && (as === "font" || as === "script" || rel.includes("modulepreload")) && element.getAttribute("href")?.startsWith(assetOrigin)) {
          element.setAttribute("crossorigin", "anonymous");
        }
        if (tag === "script" && element.getAttribute("type")?.toLowerCase() === "module" && element.getAttribute("src")?.startsWith(assetOrigin)) {
          element.setAttribute("crossorigin", "anonymous");
        }
      },
    })
    .transform(response);
}
