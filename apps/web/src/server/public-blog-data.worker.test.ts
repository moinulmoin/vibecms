/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

// isMarketingHost host classification for B2 multi-tenant routing.
// Runs under vitest.isolation.config.ts; env (PUBLIC_BLOG_DOMAIN, APP_URL)
// is provided by wrangler.test.jsonc, so the zone is dev.vibecms.dev here.
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { publicBlogBaseDomain } from "./public-url";
import { isMarketingHost } from "./public-blog-data";

const zone = publicBlogBaseDomain();
if (!zone) throw new Error("PUBLIC_BLOG_DOMAIN must be configured for these tests");

function requestWithHost(host: string): Request {
  return new Request("https://placeholder/", { headers: { host } });
}

describe("isMarketingHost", () => {
  it("classifies the apex zone as marketing", () => {
    expect(isMarketingHost(requestWithHost(zone))).toBe(true);
  });

  it("classifies app.<zone> as marketing", () => {
    expect(isMarketingHost(requestWithHost(`app.${zone}`))).toBe(true);
  });

  it("classifies the APP_URL host as marketing (app-path/self-host root)", () => {
    const appHost = new URL(env.APP_URL).hostname.toLowerCase();
    expect(isMarketingHost(requestWithHost(appHost))).toBe(true);
  });

  it("classifies localhost as marketing", () => {
    expect(isMarketingHost(requestWithHost("localhost"))).toBe(true);
  });

  it("classifies *.localhost as marketing", () => {
    expect(isMarketingHost(requestWithHost("tenant.localhost"))).toBe(true);
  });

  it("classifies an empty host as marketing", () => {
    expect(isMarketingHost(requestWithHost(""))).toBe(true);
  });

  it("classifies a tenant subdomain <slug>.<zone> as non-marketing", () => {
    expect(isMarketingHost(requestWithHost(`moinulmoin.${zone}`))).toBe(false);
  });

  it("classifies moinulmoin.vibecms.dev as non-marketing", () => {
    expect(isMarketingHost(requestWithHost("moinulmoin.vibecms.dev"))).toBe(false);
  });

  it("classifies an arbitrary custom domain as non-marketing", () => {
    expect(isMarketingHost(requestWithHost("blog.example.com"))).toBe(false);
  });
});
