import { describe, expect, it } from "vitest";
import { buildSitemapXml, xmlEscape } from "./public-feeds-xml";
import type { PostSummaryRow } from "./public-blog-data";

describe("public-feeds-xml", () => {
  it("escapes xml entities", () => {
    expect(xmlEscape(`a & b <c>`)).toBe("a &amp; b &lt;c&gt;");
  });

  it("drops characters XML 1.0 cannot represent", () => {
    expect(xmlEscape("a\u0001b\u000Bc\tD\n\uFFFE\uD800x \u{1F600}")).toBe("abc\tD\nx \u{1F600}");
  });

  it("builds sitemap with home and posts", () => {
    const posts: PostSummaryRow[] = [
      {
        id: "p1",
        title: "Hello",
        slug: "hello",
        excerpt: null,
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
      },
    ];
    const xml = buildSitemapXml("https://demo.example.com", posts);
    expect(xml).toContain("https://demo.example.com/");
    expect(xml).toContain("https://demo.example.com/hello");
  });
});