import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { collectRootLinkSlugs, renderRichContent, renderRichContentToHtml } from "./renderer.js";

const SLUGS = new Set(["hello", "world"]);
const POST = "See [hello](/hello) and [pricing](/pricing) plus [deep](/hello/sub) and ![img](/media-assets/a1).\n\nBody [a](https://external.example/x).";

function html(markdown: string, opts?: Parameters<typeof renderRichContentToHtml>[1]) {
  return renderRichContentToHtml(markdown, opts);
}

describe("subpath-hosted link rewriting (plan 022)", () => {
  it("prefixes same-site slug links and media assets, leaves the rest", () => {
    const node = renderRichContent(POST, {
      postBasePath: "/blog",
      postSlugs: SLUGS,
      assetOrigin: "https://tenant.basedui.dev",
    }).node;
    const markup = renderToStaticMarkup(createElement("div", null, node));
    expect(markup).toContain('href="/blog/hello"');
    // Links whose first segment is a published slug get the base path —
    // including deeper paths under a slug (spec: first segment matches).
    expect(markup).toContain('href="/blog/hello/sub"');
    // Non-slug root links keep normal meaning (the customer site's root).
    expect(markup).toContain('href="/pricing"');
    expect(markup).toContain('src="https://tenant.basedui.dev/media-assets/a1"');
    expect(markup).toContain('href="https://external.example/x"');
  });

  it("is a no-op without location options", () => {
    const markup = renderToStaticMarkup(createElement("div", null, renderRichContent(POST).node));
    expect(markup).toContain('href="/hello"');
    expect(markup).toContain('src="/media-assets/a1"');
    expect(markup).not.toContain("/blog/hello");
  });

  it("feed output absolutizes slug links to the customer host and media to the asset host", () => {
    const out = html(POST, {
      target: "feed",
      baseUrl: "https://customer.example.com/blog/hello",
      postBasePath: "/blog",
      postSlugs: SLUGS,
      assetOrigin: "https://tenant.basedui.dev",
    });
    expect(out).toContain('href="https://customer.example.com/blog/hello"');
    expect(out).toContain('src="https://tenant.basedui.dev/media-assets/a1"');
    expect(out).not.toContain('src="https://customer.example.com/media-assets');
  });

  it("feed output absolutizes relative image sources against the post base", () => {
    const out = html("![x](images/a.png) and ![y](/media-assets/m1)", {
      target: "feed",
      baseUrl: "https://blog.example.com/post",
    });
    // Relocated media still maps to its base; a plain relative src must not
    // survive as `images/a.png` — feed readers can't resolve it.
    expect(out).toContain('src="https://blog.example.com/images/a.png"');
    expect(out).toContain('src="https://blog.example.com/media-assets/m1"');
    expect(out).not.toContain('src="images/a.png"');
  });
});

describe("collectRootLinkSlugs", () => {
  it("collects first segments of root-relative targets only", () => {
    const md = [
      "[a](/hello) [b](/world/sub?q=1#f) [c](https://x.example/y) [d](rel) [e](//cdn.example/x)",
      "",
      "[f][ref]",
      "",
      "[ref]: /ref-slug",
      "",
      'raw <a href="/html-slug">x</a> <img src="/media-assets/m9">',
    ].join("\n");
    expect(collectRootLinkSlugs(md).sort()).toEqual(["hello", "html-slug", "ref-slug", "world"]);
  });

  it("sees the links the renderer sees: image-wrapped links and raw anchors", () => {
    const md = [
      // A link wrapping an image — the old regex missed the nested `](`.
      "[![c](images/c.png)](/older-post)",
      // Raw HTML anchor with an unquoted href the sanitizer keeps.
      "<a href=/raw-post>Older</a>",
      // Raw srcSet candidates.
      '<img src="/media-assets/m1" srcset="/srcset-post 1x, /media-assets/m2 2x">',
    ].join("\n");
    expect(collectRootLinkSlugs(md).sort()).toEqual(["older-post", "raw-post", "srcset-post"]);
  });

  it("ignores link-shaped text inside code fences", () => {
    const md = "[real](/yes)\n\n```\n[fake](/no) <a href=/nope>x</a>\n```";
    expect(collectRootLinkSlugs(md)).toEqual(["yes"]);
  });

  it("dedupes and caps candidates", () => {
    const md = Array.from({ length: 300 }, (_, i) => `[p${i}](/p${i})`).join(" ");
    expect(collectRootLinkSlugs(md).length).toBe(200);
    expect(collectRootLinkSlugs("[a](/same) [b](/same)")).toEqual(["same"]);
  });
});
