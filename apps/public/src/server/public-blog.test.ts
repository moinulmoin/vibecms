import { describe, expect, it } from "vitest";
import {
  markdownRequested,
  publicHtmlResponseHeaders,
  RESERVED_ROOT_SLUGS,
  stripMarkdownSuffix,
} from "./public-blog";
import { articleCacheTag, articleCacheTags, siteCacheTag } from "./public-blog-cache";
import { publicOrigin } from "./public-url";

const site = {
  id: "site-1",
  workspace_id: "ws-1",
  name: "Demo",
  slug: "demo",
  theme: "editorial",
  theme_accent: null,
  theme_font: null,
  theme_mode: "system",
  description: null,
  default_seo_title: null,
  default_seo_description: null,
  default_social_asset_id: null,
  default_social_asset_mime_type: null,
  default_social_asset_width: null,
  default_social_asset_height: null,
  default_social_asset_alt_text: null,
  billing_status: "active",
  current_period_end: null,
  published_count: 1,
};

const env = { appUrl: "https://app.example.com", publicBlogDomain: "example.com", selfHosted: false };

describe("markdown negotiation", () => {
  it("detects Accept: text/markdown", () => {
    const req = new Request("https://demo.example.com/post", { headers: { accept: "text/markdown" } });
    expect(markdownRequested(req)).toBe(true);
  });

  it("detects .md suffix", () => {
    expect(stripMarkdownSuffix("hello.md")).toEqual({ slug: "hello", markdown: true });
  });

  it("blocks reserved slugs", () => {
    expect(RESERVED_ROOT_SLUGS.has("feed.xml")).toBe(true);
    expect(RESERVED_ROOT_SLUGS.has("__vc-health")).toBe(true);
  });
});

describe("public origin normalization", () => {
  it("forces HTTPS for deployed hosts", () => {
    expect(publicOrigin("http://demo.example.com/post")).toBe("https://demo.example.com");
  });

  it("preserves the local development protocol and port", () => {
    expect(publicOrigin("http://demo.localhost:4321/post")).toBe("http://demo.localhost:4321");
  });
});

describe("cache tags and SEO headers", () => {
  it("builds site and article tags", () => {
    expect(siteCacheTag("site-1")).toBe("vc-site:site-1");
    expect(articleCacheTag("site-1", "hello")).toBe("vc-article:site-1:hello");
    expect(articleCacheTags("site-1", "hello")).toEqual(["vc-site:site-1", "vc-article:site-1:hello"]);
  });

  it("sets content-signal and cache-tag for indexable sites", () => {
    const headers = publicHtmlResponseHeaders(site, env, articleCacheTags(site.id, "hello"));
    expect(headers["content-signal"]).toContain("search=yes");
    expect(headers["cache-tag"]).toBe("vc-site:site-1,vc-article:site-1:hello");
  });

  it("noindexes unpaid blogs", () => {
    const unpaid = { ...site, billing_status: "inactive" };
    const headers = publicHtmlResponseHeaders(unpaid, env);
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["content-signal"]).toContain("search=no");
  });
});