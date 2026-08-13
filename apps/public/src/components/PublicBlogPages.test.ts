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
