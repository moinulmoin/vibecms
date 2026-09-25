import { describe, expect, it } from "vitest";
import {
  applyBaselineSecurityHeaders,
  applyPublicSecurityHeaders,
  buildHtmlContentSecurityPolicy,
  mergeHtmlContentSecurityPolicy,
  classifyPublicPath,
} from "./secure-response-headers";

describe("classifyPublicPath", () => {
  it("classifies media assets", () => {
    expect(classifyPublicPath("/media-assets/abc")).toBe("media");
    expect(classifyPublicPath("/og.png")).toBe("media");
    expect(classifyPublicPath("/og/hello-world.png")).toBe("media");
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
      "script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    );
  });

  it("keeps Astro's hashed script policy instead of overwriting it", () => {
    const astro = "default-src 'self'; script-src 'self' 'sha256-abc'; style-src 'self' 'unsafe-inline'";
    const headers = new Headers({ "content-type": "text/html; charset=utf-8", "content-security-policy": astro });
    applyPublicSecurityHeaders("/", "text/html; charset=utf-8", headers);
    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self' 'sha256-abc'");
    expect(csp.match(/script-src/g)).toHaveLength(1);
    expect(csp).toContain("frame-ancestors 'none'");
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
describe("mergeHtmlContentSecurityPolicy", () => {
  it("keeps Astro's script policy and appends frame/navigation directives", () => {
    const astro = "default-src 'self'; script-src 'self' 'sha256-abc'; style-src 'self' 'unsafe-inline'";
    const merged = mergeHtmlContentSecurityPolicy(astro);
    expect(merged.startsWith(astro)).toBe(true);
    expect(merged).toContain("frame-ancestors 'none'");
    expect(merged).toContain("object-src 'none'");
  });

  it("does not duplicate directives Astro already set", () => {
    const merged = mergeHtmlContentSecurityPolicy("script-src 'self'; base-uri 'self'");
    expect(merged.match(/base-uri/g)).toHaveLength(1);
  });

  it("still limits scripts to this origin when Astro sent no policy", () => {
    const merged = mergeHtmlContentSecurityPolicy(null);
    expect(merged).toContain("script-src 'self'");
    expect(merged).toContain("frame-ancestors 'none'");
  });
});
