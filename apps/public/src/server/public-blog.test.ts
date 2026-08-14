import { describe, expect, it } from "vitest";
import {
  markdownRequested,
  publicHtmlResponseHeaders,
  publicListingResponseHeaders,
  RESERVED_ROOT_SLUGS,
  stripMarkdownSuffix,
} from "./public-blog";
import {
  articleCacheTag,
  articleCacheTags,
  cachedArticleResponseBelongsToSite,
  contentEtag,
  articleMarkdownAlternateLink,
  articleResponseCacheRequest,
  matchArticleResponseCache,
  putArticleResponseCache,
  publicCacheControlForEntitlement,
  siteCacheTag,
} from "./public-blog-cache";
import { publicOrigin } from "./public-url";
import type { SiteRow } from "./public-blog-data";

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
  effective_entitlement: {
    effective: true,
    access: "hosted_paid",
    activeSources: ["polar"],
    effectiveUntil: null,
    polar: { status: "active", currentPeriodEnd: null, active: true },
    managedSponsorship: { status: null, expiresAt: null, active: false },
  },
} satisfies SiteRow;

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
    expect(RESERVED_ROOT_SLUGS.has("internal")).toBe(true);
    expect(RESERVED_ROOT_SLUGS.has("docs")).toBe(true);
    expect(RESERVED_ROOT_SLUGS.has("docs-search.json")).toBe(true);
    expect(RESERVED_ROOT_SLUGS.has("llms-full.txt")).toBe(true);
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

  it("keeps listing responses out of page and shared caches", () => {
    const headers = publicListingResponseHeaders(site, env);
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["cache-tag"]).toBeUndefined();
    expect(headers["content-signal"]).toContain("search=yes");
  });

  it("caps cache lifetime at finite entitlement expiry without stale reuse", () => {
    expect(
      publicCacheControlForEntitlement(
        { ...site.effective_entitlement, effectiveUntil: 1_000 },
        950,
      ),
    ).toBe("public, max-age=50, s-maxage=50");
    expect(
      publicCacheControlForEntitlement(
        { ...site.effective_entitlement, effective: false, effectiveUntil: null },
        950,
      ),
    ).toBe("no-store");
  });

  it("does not write no-store article responses to the Workers cache", async () => {
    const url = "https://demo.example.com/no-store-article";
    await putArticleResponseCache(
      url,
      "html",
      new Response("<html>free</html>", {
        headers: { "cache-control": "no-store" },
      }),
    );
    expect(await matchArticleResponseCache(url, "html")).toBeUndefined();
  });

  it("rejects article cache entries tagged for another resolved site", () => {
    const response = new Response("cached", {
      headers: { "cache-tag": articleCacheTags(site.id, "hello").join(",") },
    });

    expect(cachedArticleResponseBelongsToSite(response, site.id)).toBe(true);
    expect(cachedArticleResponseBelongsToSite(response, "reassigned-site")).toBe(false);
    expect(cachedArticleResponseBelongsToSite(new Response("untagged"), site.id)).toBe(false);
  });

  it("noindexes unpaid blogs", () => {
    const unpaid: SiteRow = {
      ...site,
      billing_status: "inactive",
      effective_entitlement: {
        ...site.effective_entitlement,
        effective: false,
        access: "hosted_free",
        activeSources: [],
        polar: { status: "none", currentPeriodEnd: null, active: false },
      },
    };
    const headers = publicHtmlResponseHeaders(unpaid, env);
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["content-signal"]).toContain("search=no");
  });
});

describe("article response headers for negotiation", () => {
  it("exposes Vary: Accept, Link alternate, and supplied validators on HTML responses", async () => {
    const validators = {
      etag: await contentEtag("<html>hello</html>"),
    };
    const headers = publicHtmlResponseHeaders(site, env, articleCacheTags(site.id, "hello"), {
      markdownAlternateHref: "https://demo.example.com/hello.md",
      ...validators,
    });
    expect(headers.vary).toBe("Accept");
    expect(headers.link).toBe(articleMarkdownAlternateLink("https://demo.example.com/hello.md"));
    expect(headers.etag).toBe(validators.etag);
  });
});

describe("Accept: text/markdown after cached HTML", () => {
  it("reproduces URL-keyed page-cache poisoning for Accept markdown", async () => {
    const cache = (caches as CacheStorage & { default: Cache }).default;
    const url = "https://demo.example.com/poison-hello";
    await cache.put(
      new Request(url),
      new Response("<html>cached-html</html>", {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      }),
    );
    const poisoned = await cache.match(new Request(url, { headers: { accept: "text/markdown" } }));
    expect(poisoned).toBeDefined();
    expect(poisoned!.headers.get("content-type")).toContain("text/html");
  });

  it("keeps HTML and Markdown cache variants on distinct keys so Accept cannot collide", async () => {
    const url = "https://demo.example.com/variant-hello";
    const htmlHeaders = publicHtmlResponseHeaders(site, env, articleCacheTags(site.id, "variant-hello"), {
      markdownAlternateHref: "https://demo.example.com/variant-hello.md",
      etag: await contentEtag("<html>cached-html</html>"),
    });
    await putArticleResponseCache(
      url,
      "html",
      new Response("<html>cached-html</html>", {
        headers: { "content-type": "text/html; charset=utf-8", ...htmlHeaders },
      }),
    );

    // HTML is stored at the canonical URL key.
    expect(articleResponseCacheRequest(url, "html").url).toBe(url);
    expect(articleResponseCacheRequest(url, "markdown").url).toBe(`${url}.md`);

    const htmlHit = await matchArticleResponseCache(url, "html");
    expect(htmlHit).toBeDefined();
    expect(htmlHit!.headers.get("content-type")).toContain("text/html");

    // A subsequent canonical Accept: text/markdown lookup must not see the HTML entry.
    const markdownHit = await matchArticleResponseCache(url, "markdown");
    expect(markdownHit).toBeUndefined();
  });

  it("changes the strong validator whenever rendered bytes change", async () => {
    expect(await contentEtag("<html>first</html>")).not.toBe(await contentEtag("<html>second</html>"));
  });
});
