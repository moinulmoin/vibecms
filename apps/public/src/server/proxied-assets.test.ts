/**
 * Plan 022 phase 2: proxied subpath pages rewrite root-relative URLs that name
 * our Worker (/_astro, media, OG, icons) onto the asset origin so customer.com
 * never sees them. Everything else stays untouched.
 */
import { describe, expect, it } from "vitest";
import { rewriteProxiedAssetsInHtml } from "./proxied-assets";

const ASSET_ORIGIN = "https://spl.basedui.dev";
const LOCATION = { assetOrigin: ASSET_ORIGIN };

async function rewrite(html: string): Promise<string> {
  const res = new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  return rewriteProxiedAssetsInHtml(res, LOCATION).text();
}

describe("rewriteProxiedAssetsInHtml", () => {
  it("passes non-HTML responses through unchanged", async () => {
    const res = new Response("<img src=\"/_astro/a.png\">", { headers: { "content-type": "image/svg+xml" } });
    const out = rewriteProxiedAssetsInHtml(res, LOCATION);
    expect(out).toBe(res);
    expect(await out.text()).toBe("<img src=\"/_astro/a.png\">");
  });

  it("absolutizes _astro links, scripts, and font preloads onto the asset origin", async () => {
    const html = [
      `<html><head>`,
      `<link rel="stylesheet" href="/_astro/site.ABC123.css">`,
      `<link rel="preload" href="/_astro/geist.woff2" as="font" type="font/woff2">`,
      `</head><body>`,
      `<script src="/_astro/client.DEF456.js" defer></script>`,
      `<script type="module" src="/_astro/island.GHI789.js"></script>`,
      `</body></html>`,
    ].join("");
    const out = await rewrite(html);
    expect(out).toContain(`href="${ASSET_ORIGIN}/_astro/site.ABC123.css"`);
    expect(out).toContain(`src="${ASSET_ORIGIN}/_astro/client.DEF456.js"`);
    expect(out).toContain(`src="${ASSET_ORIGIN}/_astro/island.GHI789.js"`);
    // Cross-origin font + module fetches are CORS-mode: crossorigin must be set.
    expect(out).toContain(`href="${ASSET_ORIGIN}/_astro/geist.woff2"`);
    expect(out).toMatch(/<link rel="preload"[^>]*crossorigin/);
    expect(out).toMatch(/<script type="module"[^>]*crossorigin/);
  });

  it("keeps an existing crossorigin value instead of overwriting it", async () => {
    const out = await rewrite(`<link rel="preload" href="/_astro/geist.woff2" as="font" crossorigin="use-credentials">`);
    expect(out).toContain('crossorigin="use-credentials"');
    expect(out).toContain(`href="${ASSET_ORIGIN}/_astro/geist.woff2"`);
  });

  it("rewrites media, OG, and root icon attributes", async () => {
    const html = [
      `<img src="/media-assets/asset-1" poster="/media-assets/asset-2" data-src="/media-assets/asset-3">`,
      `<script src="/_astro/blocks.js" data-mermaid-src="/_astro/mermaid.tiny.js" defer></script>`,
      `<img src="/og/hello.png">`,
      `<link rel="icon" href="/favicon.svg">`,
      `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
      `<link rel="manifest" href="/site.webmanifest">`,
    ].join("");
    const out = await rewrite(html);
    expect(out).toContain(`src="${ASSET_ORIGIN}/media-assets/asset-1"`);
    expect(out).toContain(`poster="${ASSET_ORIGIN}/media-assets/asset-2"`);
    expect(out).toContain(`data-src="${ASSET_ORIGIN}/media-assets/asset-3"`);
    expect(out).toContain(`data-mermaid-src="${ASSET_ORIGIN}/_astro/mermaid.tiny.js"`);
    expect(out).toContain(`src="${ASSET_ORIGIN}/og/hello.png"`);
    expect(out).toContain(`href="${ASSET_ORIGIN}/favicon.svg"`);
    expect(out).toContain(`href="${ASSET_ORIGIN}/apple-touch-icon.png"`);
    expect(out).toContain(`href="${ASSET_ORIGIN}/site.webmanifest"`);
  });

  it("rewrites srcset candidates and keeps descriptors", async () => {
    const html = `<img srcset="/media-assets/a?w=480 480w, https://cdn.example.com/b.png 2x, /pricing 3x">`;
    const out = await rewrite(html);
    expect(out).toContain(`${ASSET_ORIGIN}/media-assets/a?w=480 480w`);
    expect(out).toContain(`https://cdn.example.com/b.png 2x`);
    // A srcset URL naming a customer page is not an asset — untouched.
    expect(out).toContain(` /pricing 3x`);
  });

  it("keeps commas inside srcset URLs and a trailing-comma candidate intact", async () => {
    const html = `<link rel="preload" as="image" imagesrcset="/_astro/a,b.png 1x, /_astro/c.png 2x"><img srcset="/media-assets/x,/media-assets/y 2x">`;
    const out = await rewrite(html);
    expect(out).toContain(`imagesrcset="${ASSET_ORIGIN}/_astro/a,b.png 1x, ${ASSET_ORIGIN}/_astro/c.png 2x"`);
    expect(out).toContain(`srcset="${ASSET_ORIGIN}/media-assets/x,/media-assets/y 2x"`);
  });

  it("never rewrites textual meta content", async () => {
    const html = `<meta property="og:title" content="/_astro/ assets explained"><meta name="twitter:title" content="/og/ cards"><meta property="og:image:alt" content="/media-assets/ alt">`;
    const out = await rewrite(html);
    expect(out).toContain(`content="/_astro/ assets explained"`);
    expect(out).toContain(`content="/og/ cards"`);
    expect(out).toContain(`content="/media-assets/ alt"`);
  });

  it("classifies the normalized path, so dot segments that leave the asset folders stay on the customer site", async () => {
    const html = `<a href="/_astro/../pricing">p</a><a href="/media-assets/%2e%2e/about">a</a><img src="/_astro/./x.png">`;
    const out = await rewrite(html);
    expect(out).toContain(`href="/_astro/../pricing"`);
    expect(out).toContain(`href="/media-assets/%2e%2e/about"`);
    expect(out).toContain(`src="${ASSET_ORIGIN}/_astro/./x.png"`);
  });

  it("rewrites og:image / twitter:image meta content", async () => {
    const html = `<meta property="og:image" content="/og/hello.png"><meta name="twitter:image" content="/og.png?v=abc123"><meta name="description" content="hello">`;
    const out = await rewrite(html);
    expect(out).toContain(`content="${ASSET_ORIGIN}/og/hello.png"`);
    expect(out).toContain(`content="${ASSET_ORIGIN}/og.png?v=abc123"`);
    expect(out).toContain(`content="hello"`);
  });

  it("leaves blog links, author root-relative links, and external URLs alone", async () => {
    const html = [
      `<a href="/blog/hello">post</a>`,
      `<a href="/pricing">customer pricing</a>`,
      `<a href="https://external.example/x">ext</a>`,
      `<a href="//cdn.example.com/x">proto-relative</a>`,
      `<img src="images/inline.png">`,
      `<link rel="stylesheet" href="${ASSET_ORIGIN}/_astro/already-absolute.css">`,
    ].join("");
    const out = await rewrite(html);
    expect(out).toContain(`href="/blog/hello"`);
    expect(out).toContain(`href="/pricing"`);
    expect(out).toContain(`href="https://external.example/x"`);
    expect(out).toContain(`href="//cdn.example.com/x"`);
    expect(out).toContain(`src="images/inline.png"`);
    expect(out).toContain(`href="${ASSET_ORIGIN}/_astro/already-absolute.css"`);
    expect(out).not.toContain(`${ASSET_ORIGIN}${ASSET_ORIGIN}`);
  });

  it("leaves code text alone — only attributes are rewritten", async () => {
    const html = `<pre><code>fetch("/_astro/x.js")</code></pre><script>const s = "/media-assets/y";</script>`;
    const out = await rewrite(html);
    expect(out).toContain(`fetch("/_astro/x.js")`);
    expect(out).toContain(`"/media-assets/y"`);
  });
});
