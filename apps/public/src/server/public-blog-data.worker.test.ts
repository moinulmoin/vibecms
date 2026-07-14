/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { parsePublicRuntimeEnv } from "./public-url";
import { isMarketingHost } from "./public-blog-data";

const runtimeEnv = parsePublicRuntimeEnv(env);
const zone = runtimeEnv.publicBlogDomain;
if (!zone) throw new Error("PUBLIC_BLOG_DOMAIN must be configured for these tests");

function requestWithHost(host: string): Request {
  return new Request("https://placeholder/", { headers: { host } });
}

describe("isMarketingHost", () => {
  it("classifies the apex zone as marketing", () => {
    expect(isMarketingHost(requestWithHost(zone), runtimeEnv)).toBe(true);
  });

  it("classifies app.<zone> as marketing", () => {
    expect(isMarketingHost(requestWithHost(`app.${zone}`), runtimeEnv)).toBe(true);
  });

  it("classifies the APP_URL host as marketing", () => {
    const appHost = new URL(env.APP_URL).hostname.toLowerCase();
    expect(isMarketingHost(requestWithHost(appHost), runtimeEnv)).toBe(true);
  });

  it("classifies tenant subdomains as non-marketing", () => {
    expect(isMarketingHost(requestWithHost(`tenant.${zone}`), runtimeEnv)).toBe(false);
  });

  it("classifies custom domains as non-marketing", () => {
    expect(isMarketingHost(requestWithHost("blog.example.com"), runtimeEnv)).toBe(false);
  });
});