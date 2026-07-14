import { describe, expect, it } from "vitest";
import {
  applyBaselineSecurityHeaders,
  applyPublicSecurityHeaders,
  buildHtmlContentSecurityPolicy,
  classifyPublicPath,
} from "./secure-response-headers";

describe("classifyPublicPath", () => {
  it("classifies media assets", () => {
    expect(classifyPublicPath("/media-assets/abc")).toBe("media");
  });
  it("classifies feeds", () => {
    expect(classifyPublicPath("/feed.xml")).toBe("feed");
  });
  it("classifies html by default", () => {
    expect(classifyPublicPath("/my-post")).toBe("html");
  });
});

describe("buildHtmlContentSecurityPolicy", () => {
  it("emits only the public-middleware restrictions (base/form/frame/object)", () => {
    const csp = buildHtmlContentSecurityPolicy();
    // The public middleware owns only these restrictions; Astro owns script/style.
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("does not own script-src or style-src (Astro hashes those)", () => {
    const csp = buildHtmlContentSecurityPolicy();
    expect(csp).not.toMatch(/\bscript-src\b/);
    expect(csp).not.toMatch(/\bstyle-src\b/);
    expect(csp).not.toMatch(/'unsafe-inline'/);
    expect(csp).not.toMatch(/'unsafe-eval'/);
  });
});

describe("applyPublicSecurityHeaders", () => {
  it("sets nosniff on media without restrictive CSP", () => {
    const headers = new Headers({ "content-type": "image/png" });
    applyPublicSecurityHeaders("/media-assets/x", "image/png", headers);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Content-Security-Policy")).toBeNull();
  });

  it("sets the exact response-only base/form/frame/object CSP on pages", () => {
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    applyPublicSecurityHeaders("/", "text/html; charset=utf-8", headers);
    // Astro emits script/style CSP via a <meta> element; the response header
    // carries only these navigation restrictions (multiple policies are cumulative).
    expect(headers.get("Content-Security-Policy")).toBe(
      "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    );
  });

  it("never adds script/style/default-src to the response CSP", () => {
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    applyPublicSecurityHeaders("/", "text/html; charset=utf-8", headers);
    const csp = headers.get("Content-Security-Policy");
    // A response script-src 'self' would block Astro's inline hashed islands.
    expect(csp).not.toMatch(/\bscript-src\b/);
    expect(csp).not.toMatch(/\bstyle-src\b/);
    expect(csp).not.toMatch(/\bdefault-src\b/);
    expect(csp).not.toMatch(/'unsafe-inline'/);
    expect(csp).not.toMatch(/'unsafe-eval'/);
  });

  it("sets minimal CSP on feeds", () => {
    const headers = new Headers({ "content-type": "application/xml" });
    applyPublicSecurityHeaders("/feed.xml", "application/xml", headers);
    expect(headers.get("Content-Security-Policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("applyBaselineSecurityHeaders", () => {
  it("sets baseline hardening", () => {
    const headers = new Headers();
    applyBaselineSecurityHeaders(headers);
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});