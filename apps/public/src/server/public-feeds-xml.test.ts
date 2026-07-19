import { describe, expect, it } from "vitest";
import { buildSitemapXml, xmlEscape } from "./public-feeds-xml";
import type { PostRow } from "./public-blog-data";

describe("public-feeds-xml", () => {
  it("escapes xml entities", () => {
    expect(xmlEscape(`a & b <c>`)).toBe("a &amp; b &lt;c&gt;");
  });

  it("builds sitemap with home and posts", () => {
    const posts: PostRow[] = [
      {
        id: "p1",
        title: "Hello",
        slug: "hello",
        excerpt: null,
        content_markdown: "body",
        cover_asset_id: null,
        cover_asset_mime_type: null,
        cover_asset_width: null,
        cover_asset_height: null,
        cover_asset_alt_text: null,
        published_at: 1_700_000_000,
        updated_at: 1_700_000_100,
        seo_title: null,
        seo_description: null,
        canonical_url: null,
        tags_json: "[]",
        presentation_json: null,
      },
    ];
    const xml = buildSitemapXml("https://demo.example.com", posts);
    expect(xml).toContain("https://demo.example.com/");
    expect(xml).toContain("https://demo.example.com/hello");
  });
});