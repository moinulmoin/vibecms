import { describe, expect, it } from "vitest";
import {
  directLocation,
  proxiedLocation,
  publicBaseUrl,
  publicHref,
  publicLocationRequest,
  publicUrl,
} from "./public-location";

const direct = directLocation(new Request("https://tenant.basedui.dev/hello?x=1"));
const proxied = proxiedLocation(
  { hostname: "customer.com", basePath: "/blog" },
  new Request("https://tenant.basedui.dev/_vc/p/abc/hello", { headers: { host: "tenant.basedui.dev" } }),
);

describe("public location", () => {
  it("direct location mirrors the request origin with no base path", () => {
    expect(direct).toEqual({
      origin: "https://tenant.basedui.dev",
      basePath: "",
      assetOrigin: "https://tenant.basedui.dev",
      proxied: false,
    });
  });

  it("proxied location uses the customer origin and our host for assets", () => {
    expect(proxied).toEqual({
      origin: "https://customer.com",
      basePath: "/blog",
      assetOrigin: "https://tenant.basedui.dev",
      proxied: true,
    });
  });

  it("publicHref prefixes the base path and maps / to the location root", () => {
    expect(publicHref(direct, "/")).toBe("/");
    expect(publicHref(proxied, "/")).toBe("/blog");
    expect(publicHref(proxied, "/post")).toBe("/blog/post");
    expect(publicHref(proxied, "/feed.xml")).toBe("/blog/feed.xml");
  });

  it("publicUrl builds absolute customer-facing URLs", () => {
    expect(publicUrl(direct, "/post")).toBe("https://tenant.basedui.dev/post");
    expect(publicUrl(proxied, "/post")).toBe("https://customer.com/blog/post");
    expect(publicUrl(proxied, "/")).toBe("https://customer.com/blog");
    expect(publicBaseUrl(proxied)).toBe("https://customer.com/blog");
    expect(publicBaseUrl(direct)).toBe("https://tenant.basedui.dev");
  });

  it("publicLocationRequest returns the request unchanged when direct", () => {
    const request = new Request("https://tenant.basedui.dev/post");
    expect(publicLocationRequest(request, direct, "/post")).toBe(request);
    expect(publicLocationRequest(request, null, "/post")).toBe(request);
  });

  it("publicLocationRequest rewrites the URL but preserves headers", () => {
    const request = new Request("https://tenant.basedui.dev/_vc/p/abc/post?utm=1", {
      headers: { host: "tenant.basedui.dev", accept: "text/html" },
    });
    const synthetic = publicLocationRequest(request, proxied, "/post");
    expect(synthetic.url).toBe("https://customer.com/blog/post?utm=1");
    expect(synthetic.headers.get("host")).toBe("tenant.basedui.dev");
    expect(synthetic.headers.get("accept")).toBe("text/html");
  });
});
