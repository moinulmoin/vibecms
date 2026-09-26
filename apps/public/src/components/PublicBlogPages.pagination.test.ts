import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PublicBlogIndexView, requestedPublicPage } from "./PublicBlogPages";
import type { PublicIndexLoaderData } from "../server/public-blog";

it("renders database page eleven and links back to page ten", () => {
  const data = {
    site: { id: "site", slug: "site", name: "Site", theme: "minimal", description: null, theme_accent: null, theme_font: null, theme_mode: "system" },
    posts: [{ id: "oldest", title: "Oldest post", slug: "oldest", excerpt: null, cover_asset_id: null, published_at: 1, updated_at: 1, seo_title: null, seo_description: null, canonical_url: null, cover_asset_mime_type: null, cover_asset_width: null, cover_asset_height: null, cover_asset_alt_text: null, tags_json: "[]" }],
    totalPosts: 201,
    page: 11,
    basePath: "",
    indexable: true,
    listing: { kind: "index" },
    sidebar: { recent: [], tags: [] },
  } as unknown as PublicIndexLoaderData;
  const html = renderToStaticMarkup(createElement(PublicBlogIndexView, { data, page: 11 }));
  expect(html).toContain("Oldest post");
  expect(html).toContain("?page=10");
  expect(requestedPublicPage("11")).toBe(11);
});
