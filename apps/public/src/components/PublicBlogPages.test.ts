import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicIndexLoaderData } from "../server/public-blog";
import { PublicBlogIndexView } from "./PublicBlogPages";

function indexData(listing: PublicIndexLoaderData["listing"]): PublicIndexLoaderData {
  return {
    site: {
      id: "site-heading-test",
      slug: "heading-test",
      name: "Heading Test",
      description: "A test publication.",
      theme: "minimal",
      theme_accent: "teal",
      theme_font: "sans",
      theme_mode: "system",
    },
    posts: [],
    basePath: "",
    indexable: listing.kind === "index",
    listing,
  } as unknown as PublicIndexLoaderData;
}

describe("PublicBlogIndexView heading outline", () => {
  it("uses the site name as the only h1 on the homepage", () => {
    const html = renderToStaticMarkup(
      createElement(PublicBlogIndexView, { data: indexData({ kind: "index" }) }),
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Heading Test");
  });

  it("uses the results heading as the only h1 on search pages", () => {
    const html = renderToStaticMarkup(
      createElement(PublicBlogIndexView, {
        data: indexData({ kind: "search", query: "reliability" }),
      }),
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Results for reliability");
  });
});

describe("listing pagination params", () => {
  it("clamps ?page to the pages that exist", async () => {
    const { resolvePublicPage, publicPageCanonicalPath } = await import("./PublicBlogPages");
    expect(resolvePublicPage(null, 50)).toBe(1);
    expect(resolvePublicPage("2", 50)).toBe(2);
    expect(resolvePublicPage("999", 50)).toBe(3);
    expect(resolvePublicPage("0", 50)).toBe(1);
    expect(resolvePublicPage("-3", 50)).toBe(1);
    expect(resolvePublicPage("2abc", 50)).toBe(1);
    expect(resolvePublicPage("5", 0)).toBe(1);
    expect(publicPageCanonicalPath("/", 1)).toBe("/");
    expect(publicPageCanonicalPath("/tag/a%20b", 3)).toBe("/tag/a%20b?page=3");
  });
});
