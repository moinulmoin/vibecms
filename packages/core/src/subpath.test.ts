import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { proxyFingerprint, redactProxyLinks, subpathProxyTarget, subpathSnippets } from "./subpath";

const input = { hostname: "customer.com", basePath: "/blog", proxyTarget: "https://my-site.vibecms.dev/_vc/p/abc123def456" };

describe("proxyFingerprint", () => {
  it("matches the first 6 bytes of SHA-256 as hex (the old apps/public implementation)", async () => {
    const expected = createHash("sha256").update("abc123def456").digest("hex").slice(0, 12);
    assert.equal(await proxyFingerprint("abc123def456"), expected);
    assert.equal((await proxyFingerprint("abc123def456")).length, 12);
  });
});

describe("subpathProxyTarget", () => {
  it("builds the ingress URL on the site's default host", () => {
    assert.equal(
      subpathProxyTarget({ slug: "my-site", publicBlogDomain: "vibecms.dev", proxyId: "abc123def456" }),
      "https://my-site.vibecms.dev/_vc/p/abc123def456",
    );
  });
});

describe("subpathSnippets", () => {
  it("fills the real basePath, route, and target into every snippet", () => {
    const s = subpathSnippets(input);

    assert.equal(s.cloudflareWorker.route, "customer.com/blog*");
    assert.match(s.cloudflareWorker.code, /pathname\.slice\("\/blog"\.length\)/);
    assert.match(s.cloudflareWorker.code, /100k requests\/day/);
    assert.match(s.cloudflareWorker.code, /https:\/\/my-site\.vibecms\.dev\/_vc\/p\/abc123def456/);

    assert.match(s.vercel, /"source": "\/blog"/);
    assert.match(s.vercel, /"source": "\/blog\/:path\*"/);
    assert.match(s.vercel, /"destination": "https:\/\/my-site\.vibecms\.dev\/_vc\/p\/abc123def456\/:path\*"/);

    assert.match(s.nextjs, /source: "\/blog\/:path\*"/);
    assert.match(s.nextjs, /process\.env\.VIBECMS_PROXY_TARGET/);
    // The env-var rewrite must never embed the credential.
    assert.doesNotMatch(s.nextjs, /my-site\.vibecms\.dev/);
    assert.doesNotMatch(s.nextjs, /abc123def456/);
    assert.doesNotMatch(s.nextjs, /\/_vc\/p\//);
    assert.match(s.netlify, /\/blog\/\* +https:\/\/my-site\.vibecms\.dev\/_vc\/p\/abc123def456\/:splat +200!/);

    assert.match(s.nginx, /location \^~ \/blog\//);
    assert.match(s.nginx, /location = \/blog /);
    assert.match(s.nginx, /proxy_set_header Host my-site\.vibecms\.dev;/);
    assert.match(s.nginx, /proxy_ssl_server_name on;/);
    assert.equal((s.nginx.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g) ?? []).length, 2);

    assert.match(s.caddy, /@vcblog path \/blog \/blog\/\*/);
    assert.match(s.caddy, /handle @vcblog \{/);
    assert.match(s.caddy, /uri strip_prefix \/blog/);
    assert.match(s.caddy, /rewrite \* \/_vc\/p\/abc123def456\{uri\}/);
    assert.match(s.caddy, /header_up Host my-site\.vibecms\.dev/);
    assert.doesNotMatch(s.caddy, /handle_path/);
  });

  it("never forwards the customer Host header to vibecms", () => {
    const s = subpathSnippets(input);
    for (const [name, text] of Object.entries({
      worker: s.cloudflareWorker.code,
      vercel: s.vercel,
      nextjs: s.nextjs,
      netlify: s.netlify,
      nginx: s.nginx,
      caddy: s.caddy,
    })) {
      assert.doesNotMatch(text, /customer\.com(?!\/)/, `${name} must not reference the customer host as upstream`);
    }
  });

  it("works for a nested base path", () => {
    const s = subpathSnippets({ hostname: "acme.io", basePath: "/resources/blog", proxyTarget: input.proxyTarget });
    assert.equal(s.cloudflareWorker.route, "acme.io/resources/blog*");
    assert.match(s.cloudflareWorker.code, /"\/resources\/blog"/);
    assert.match(s.vercel, /"source": "\/resources\/blog\/:path\*"/);
    assert.match(s.nginx, /location \^~ \/resources\/blog\//);
    assert.match(s.caddy, /@vcblog path \/resources\/blog \/resources\/blog\/\*/);
    assert.match(s.netlify, /\/resources\/blog\/\* +/);
    assert.match(s.nextjs, /process\.env\.VIBECMS_PROXY_TARGET/);
    assert.doesNotMatch(s.nextjs, /\/_vc\/p\//);
  });

  it("lets sibling paths like /blogx fall through to the customer's own origin", async () => {
    const s = subpathSnippets(input);
    // Evaluate the generated Worker module against a fake fetch.
    const worker = new Function(`"use strict"; ${s.cloudflareWorker.code.replace("export default", "return")}`)() as {
      fetch: (request: Request) => Promise<Response>;
    };
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (req: Request) => {
      seen.push(req.url);
      return new Response("origin answer");
    }) as typeof fetch;
    try {
      // Exact base and descendants proxy to the ingress.
      await worker.fetch(new Request("https://customer.com/blog"));
      await worker.fetch(new Request("https://customer.com/blog/post-1?x=1"));
      // A sibling path must reach the customer origin untouched.
      await worker.fetch(new Request("https://customer.com/blogx"));
      await worker.fetch(new Request("https://customer.com/blogx/post"));
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(seen[0], "https://my-site.vibecms.dev/_vc/p/abc123def456/");
    assert.equal(seen[1], "https://my-site.vibecms.dev/_vc/p/abc123def456/post-1?x=1");
    assert.equal(seen[2], "https://customer.com/blogx");
    assert.equal(seen[3], "https://customer.com/blogx/post");
  });

  it("overwrites a spoofable X-Forwarded-For with CF-Connecting-IP", async () => {
    const s = subpathSnippets(input);
    const worker = new Function(`"use strict"; ${s.cloudflareWorker.code.replace("export default", "return")}`)() as {
      fetch: (request: Request) => Promise<Response>;
    };
    const seen: (string | null)[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (req: Request) => {
      seen.push(req.headers.get("x-forwarded-for"));
      return new Response("origin answer");
    }) as typeof fetch;
    try {
      await worker.fetch(
        new Request("https://customer.com/blog/post-1", {
          headers: { "CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "198.51.100.7" },
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(seen[0], "203.0.113.9");
  });
});

describe("redactProxyLinks", () => {
  it("strips the proxy id out of any URL or message", () => {
    assert.equal(
      redactProxyLinks("redirects to https://customer.com/_vc/p/abc123def456/ instead"),
      "redirects to https://customer.com/_vc/p/\u2026/ instead",
    );
    assert.equal(redactProxyLinks("no /_vc/ paths here"), "no /_vc/ paths here");
    assert.equal(redactProxyLinks("https://x.test/_vc/p/abc_123-DEF?y=1"), "https://x.test/_vc/p/\u2026?y=1");
  });
});
