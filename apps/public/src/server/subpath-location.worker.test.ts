/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * Plan 022 slice B: subpath-hosted blogs (customer.com/blog) — proxy ingress,
 * primary-location redirects, location-fed producers, and cache-key split.
 * Runs against real miniflare D1; IDs are file-scoped ("spl-*").
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { parsePublicRuntimeEnv } from "./public-url";
import { proxiedLocation, publicLocationRequest } from "./public-location";
import { ingressStateForPass, primaryLocationRedirect, proxyFingerprint, resolvePublicLocationIngress } from "./public-location.server";
import {
  handlePublicPostByHostGet,
  loadPublicIndexByHost,
  loadPublicPostForSite,
  loadPublicTagByHost,
  publicPostRedirect,
} from "./public-blog";
import { matchArticleResponseCache, putArticleResponseCache } from "./public-blog-cache";
import { handleFeed, handleLlmsTxt, handleRobots, handleSitemap } from "./public-feeds";
import { resolvePublishedLinkSlugs, resolveSite } from "./public-blog-data";
import { normalizeReferrerHost } from "./public-analytics";
import { listingMarkdown } from "../lib/agent-pages";
import { rewriteProxiedAssetsInHtml } from "./proxied-assets";
import { applyPublicSecurityHeaders } from "./secure-response-headers";
import type { PublicIndexLoaderData } from "./public-blog";
import { POST as viewPost } from "../pages/api/analytics/view";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const runtimeEnv = parsePublicRuntimeEnv(env);
const T = 1_700_000_000;
const HOST = "spl.basedui.dev";
const CUSTOMER = "https://customer.example.com";
const PROXY_ID = "spl-proxy-0123456789abcdef";
const INACTIVE_PROXY_ID = "spl-inactive-0123456789ab";
const OTHER_PROXY_ID = "spl-other-0123456789abcde";
const FREE_PROXY_ID = "spl-free-0123456789abcdef";
const FREE_HOST = "spl-free.basedui.dev";
const FREE_CUSTOM_HOST = "spl-free-custom.basedui.dev";

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://${HOST}${path}`, { ...init, headers: { host: HOST, ...init?.headers } });
}

/** The proxied location + synthetic request producers see for `path`. */
function proxied(path: string, init?: RequestInit) {
  const req = request(`/_vc/p/${PROXY_ID}${path === "/" ? "" : path}`, init);
  const location = proxiedLocation({ hostname: "customer.example.com", basePath: "/blog" }, req);
  return { location, request: publicLocationRequest(req, location, path) };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  const exec = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();

  await exec("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    "ws-spl", "Spl", "ws-spl", T, T);
  await exec("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "site-spl", "ws-spl", "Spl Blog", "spl", T, T);
  await exec("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "site-spl-other", "ws-spl", "Other Blog", "spl-other", T, T);
  await exec("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "site-spl-custom", "ws-spl", "Custom Blog", "spl-custom", T, T);
  await exec("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    "bc-spl", "ws-spl", T, T);

  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-default", "site-spl", HOST, "default", "active", null, null, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-subpath", "site-spl", "customer.example.com", "subpath", "active", "/blog", PROXY_ID, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-inactive", "site-spl", "old.example.com", "subpath", "pending", "/news", INACTIVE_PROXY_ID, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-other", "site-spl-other", "other.example.com", "subpath", "active", "/notes", OTHER_PROXY_ID, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-custom", "site-spl-custom", "spl-custom.basedui.dev", "default", "active", null, null, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-custom-domain", "site-spl-custom", "blog.spl-custom.com", "custom", "active", null, null, T, T);

  const postColumns = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
  await exec(`INSERT INTO posts (${postColumns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'spl', 'api_key', 'spl', ?, ?)`,
    "post-spl-hello", "site-spl", "Hello", "hello", "# Hello", T, T, T);
  await exec(`INSERT INTO posts (${postColumns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'spl', 'api_key', 'spl', ?, ?)`,
    "post-spl-world", "site-spl", "World", "world", "# World", T, T, T);
  for (const row of [
    { id: "post-spl-hello", title: "Hello", slug: "hello", body: "# Hello\n\n[internal](/world) [media](/media-assets/asset-1) ![i](/media-assets/asset-2)" },
    { id: "post-spl-world", title: "World", slug: "world", body: "# World" },
  ]) {
    const versionId = crypto.randomUUID();
    await exec(
      "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at, tags_json) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 'spl', 'seed', ?, ?)",
      versionId, row.id, "site-spl", row.title, row.slug, row.body, T, JSON.stringify(["news"]));
    await exec("UPDATE posts SET published_version_id = ? WHERE id = ?", versionId, row.id);
  }
  await exec(
    "INSERT INTO post_slug_redirects (site_id, post_id, from_slug, created_at) VALUES (?, ?, ?, ?)",
    "site-spl", "post-spl-hello", "old-hello", T);
  // Unentitled sites (no billing row on their workspace): subpath mounts stop
  // serving, paid primary locations stop redirecting, default hosts keep reading.
  await exec("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    "ws-spl-free", "Spl Free", "ws-spl-free", T, T);
  await exec("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "site-spl-free", "ws-spl-free", "Free Blog", "spl-free", T, T);
  await exec("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "site-spl-freec", "ws-spl-free", "Free Custom Blog", "spl-freec", T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-free-def", "site-spl-free", FREE_HOST, "default", "active", null, null, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-free-sub", "site-spl-free", "free.example.com", "subpath", "active", "/blog", FREE_PROXY_ID, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-freec-def", "site-spl-freec", FREE_CUSTOM_HOST, "default", "active", null, null, T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-freec-cust", "site-spl-freec", "blog.free-custom.com", "custom", "active", null, null, T, T);

  // A blog whose link target sits outside the 200-summary window: the oldest
  // of 201 published posts plus one post linking to it.
  await exec("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "site-spl-links", "ws-spl", "Links Blog", "spl-links", T, T);
  await exec(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    "dom-spl-links", "site-spl-links", "spl-links.basedui.dev", "default", "active", null, null, T, T);
  const linkPostColumns = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
  const linkVersionColumns = "id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at, tags_json";
  const linkStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < 201; i++) {
    const slug = `old-link-${i}`;
    linkStatements.push(
      env.DB.prepare(`INSERT INTO posts (${linkPostColumns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'spl', 'api_key', 'spl', ?, ?)`)
        .bind(`post-spl-l${i}`, "site-spl-links", `Post ${i}`, slug, "# body", T + i, T + i, T + i),
      env.DB.prepare(`INSERT INTO post_versions (${linkVersionColumns}) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 'spl', 'seed', ?, '[]')`)
        .bind(`pv-spl-l${i}`, `post-spl-l${i}`, "site-spl-links", `Post ${i}`, slug, "# body", T + i),
    );
  }
  linkStatements.push(
    env.DB.prepare(`INSERT INTO posts (${linkPostColumns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'spl', 'api_key', 'spl', ?, ?)`)
      .bind("post-spl-linker", "site-spl-links", "Linker", "linker", "[older](/old-link-0) [unknown](/nope)", T + 300, T + 300, T + 300),
    env.DB.prepare(`INSERT INTO post_versions (${linkVersionColumns}) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 'spl', 'seed', ?, '[]')`)
      .bind("pv-spl-linker", "post-spl-linker", "site-spl-links", "Linker", "linker", "[older](/old-link-0) [unknown](/nope)", T + 300),
  );
  await env.DB.batch(linkStatements);
  const pinStatements: D1PreparedStatement[] = [];
  for (let i = 0; i < 201; i++) {
    pinStatements.push(env.DB.prepare("UPDATE posts SET published_version_id = ? WHERE id = ?").bind(`pv-spl-l${i}`, `post-spl-l${i}`));
  }
  pinStatements.push(env.DB.prepare("UPDATE posts SET published_version_id = ? WHERE id = ?").bind("pv-spl-linker", "post-spl-linker"));
  await env.DB.batch(pinStatements);
});

describe("proxy ingress", () => {
  it("rewrites a valid proxy id to the stripped path with a proxied location", async () => {
    const result = await resolvePublicLocationIngress(env.DB, request(`/_vc/p/${PROXY_ID}/hello`), `/_vc/p/${PROXY_ID}/hello`, runtimeEnv);
    expect(result).toMatchObject({ kind: "proxied", path: "/hello" });
    if (result.kind !== "proxied") return;
    expect(result.location).toEqual({
      origin: CUSTOMER,
      basePath: "/blog",
      assetOrigin: `https://${HOST}`,
      proxied: true,
    });
  });

  it("defaults the stripped path to / and preserves direct traffic", async () => {
    const root = await resolvePublicLocationIngress(env.DB, request(`/_vc/p/${PROXY_ID}`), `/_vc/p/${PROXY_ID}`, runtimeEnv);
    expect(root).toMatchObject({ kind: "proxied", path: "/" });
    expect(await resolvePublicLocationIngress(env.DB, request("/hello"), "/hello", runtimeEnv)).toEqual({ kind: "direct" });
  });

  it("404s unknown and wrong-site proxy ids; pending rows are not-connected", async () => {
    const bad = `/_vc/p/${"x".repeat(24)}/hello`;
    expect(await resolvePublicLocationIngress(env.DB, request(bad), bad, runtimeEnv)).toEqual({ kind: "not-found" });
    // A saved-but-unverified row answers health (the setup check needs it) and
    // its pages get the "not connected" 404 — never a rendered page.
    const inactive = `/_vc/p/${INACTIVE_PROXY_ID}/hello`;
    expect(await resolvePublicLocationIngress(env.DB, request(inactive), inactive, runtimeEnv)).toEqual({ kind: "not-connected" });
    // site-spl-other's id quoted on site-spl's host must not mint traffic.
    const wrongSite = `/_vc/p/${OTHER_PROXY_ID}/hello`;
    expect(await resolvePublicLocationIngress(env.DB, request(wrongSite), wrongSite, runtimeEnv)).toEqual({ kind: "not-found" });
  });

  it("serves _vc/health in both modes", async () => {
    const proxiedHealth = await resolvePublicLocationIngress(env.DB, request(`/_vc/p/${PROXY_ID}/_vc/health`), `/_vc/p/${PROXY_ID}/_vc/health`, runtimeEnv);
    expect(proxiedHealth).toEqual({ kind: "health", siteId: "site-spl", proxyFingerprint: await proxyFingerprint(PROXY_ID) });
    // The probe never echoes the proxy id itself.
    expect(JSON.stringify(proxiedHealth)).not.toContain(PROXY_ID);
    // Pending/failed rows answer health too — that is how "Check setup"
    // verifies the proxy before the row can serve pages.
    const pendingHealth = await resolvePublicLocationIngress(env.DB, request(`/_vc/p/${INACTIVE_PROXY_ID}/_vc/health`), `/_vc/p/${INACTIVE_PROXY_ID}/_vc/health`, runtimeEnv);
    expect(pendingHealth).toEqual({ kind: "health", siteId: "site-spl", proxyFingerprint: await proxyFingerprint(INACTIVE_PROXY_ID) });
    const directHealth = await resolvePublicLocationIngress(env.DB, request("/_vc/health"), "/_vc/health", runtimeEnv);
    expect(directHealth).toEqual({ kind: "health", siteId: "site-spl", proxyFingerprint: null });
  });
});

describe("primary-location redirects", () => {
  const location = { origin: `https://${HOST}`, basePath: "", assetOrigin: `https://${HOST}`, proxied: false };

  it("301s default-host page GETs to the subpath primary, keeping query", async () => {
    const redirect = await primaryLocationRedirect(env.DB, request("/hello?page=2"), "/hello", runtimeEnv, location);
    expect(redirect?.status).toBe(301);
    expect(redirect?.headers.get("location")).toBe(`${CUSTOMER}/blog/hello?page=2`);
    // The destination is entitlement-dependent: no-cache forces revalidation
    // so a lapsed sponsorship never strands readers on a mount that 404s.
    expect(redirect?.headers.get("cache-control")).toBe("no-cache");
  });

  it("redirects feeds and .md twins but never exempt paths", async () => {
    const feed = await primaryLocationRedirect(env.DB, request("/feed.xml"), "/feed.xml", runtimeEnv, location);
    expect(feed?.headers.get("location")).toBe(`${CUSTOMER}/blog/feed.xml`);
    const md = await primaryLocationRedirect(env.DB, request("/hello.md"), "/hello.md", runtimeEnv, location);
    expect(md?.headers.get("location")).toBe(`${CUSTOMER}/blog/hello.md`);
    for (const path of ["/api/subscribe", "/media-assets/abc", "/og/hello.png", "/og.png", "/_vc/health", "/_astro/app.js", "/preview/tok", "/favicon.svg", "/__vc-health", "/internal/tenant"]) {
      expect(await primaryLocationRedirect(env.DB, request(path), path, runtimeEnv, location)).toBeNull();
    }
    expect(await primaryLocationRedirect(env.DB, request("/hello", { method: "POST" }), "/hello", runtimeEnv, location)).toBeNull();
    // Marketing host never redirects.
    const marketing = new Request("https://basedui.dev/hello", { headers: { host: "basedui.dev" } });
    expect(await primaryLocationRedirect(env.DB, marketing, "/hello", runtimeEnv, location)).toBeNull();
    // Self-hosted has no canon.
    expect(await primaryLocationRedirect(env.DB, request("/hello"), "/hello", { ...runtimeEnv, selfHosted: true }, location)).toBeNull();
    // Proxied requests already are the primary location.
    expect(await primaryLocationRedirect(env.DB, request("/hello"), "/hello", runtimeEnv, { ...location, proxied: true })).toBeNull();
  });

  it("301s to a custom-domain primary and leaves the custom host alone", async () => {
    const onDefault = new Request("https://spl-custom.basedui.dev/post", { headers: { host: "spl-custom.basedui.dev" } });
    const redirect = await primaryLocationRedirect(env.DB, onDefault, "/post", runtimeEnv, location);
    expect(redirect?.headers.get("location")).toBe("https://blog.spl-custom.com/post");
    const onCustom = new Request("https://blog.spl-custom.com/post", { headers: { host: "blog.spl-custom.com" } });
    expect(await primaryLocationRedirect(env.DB, onCustom, "/post", runtimeEnv, location)).toBeNull();
  });
});

describe("producers in proxied mode", () => {
  it("post loader carries the location through every field", async () => {
    const { location, request: req } = proxied("/hello");
    const site = await resolveSite(request("/hello"), env.DB, runtimeEnv);
    const blog = await loadPublicPostForSite(env.DB, location, site!, "hello", runtimeEnv);
    expect(blog).toMatchObject({
      basePath: "/blog",
      assetOrigin: `https://${HOST}`,
      proxied: true,
      canonicalUrl: "/blog/hello",
      origin: CUSTOMER,
    });
    // Link slugs resolve from the body (only /world is a root-relative post link).
    expect(blog!.postSlugs).toEqual(new Set(["world"]));
    expect(req.url).toBe(`${CUSTOMER}/blog/hello`);
  });

  it("listing loaders carry basePath, assetOrigin, and proxied", async () => {
    const { location } = proxied("/");
    const index = await loadPublicIndexByHost(env.DB, request("/"), runtimeEnv, undefined, 1, location);
    expect(index).toMatchObject({ basePath: "/blog", proxied: true, assetOrigin: `https://${HOST}` });
    const tag = await loadPublicTagByHost(env.DB, request("/tag/news"), "news", runtimeEnv, 1, location);
    expect(tag).toMatchObject({ basePath: "/blog", proxied: true });
  });

  it("markdown responses use customer URLs for canonical, Link, and cache", async () => {
    const { location, request: req } = proxied("/hello", { headers: { accept: "text/markdown" } });
    const res = await handlePublicPostByHostGet(env.DB, req, "hello", runtimeEnv, location);
    expect(res).toBeTruthy();
    const body = await res!.text();
    expect(body).toContain(`canonical: ${CUSTOMER}/blog/hello`);
    expect(res!.headers.get("link")).toContain(`<${CUSTOMER}/blog/hello.md>`);
    // Direct mode stays identical to before.
    const directReq = request("/hello", { headers: { accept: "text/markdown" } });
    const directRes = await handlePublicPostByHostGet(env.DB, directReq, "hello", runtimeEnv);
    const directBody = await directRes!.text();
    expect(directBody).toContain(`canonical: https://${HOST}/hello`);
  });

  it("slug redirects land under the customer base path", async () => {
    const { location, request: req } = proxied("/old-hello");
    const site = (await resolveSite(request("/x"), env.DB, runtimeEnv))!;
    const redirect = await publicPostRedirect(env.DB, site, "old-hello", req, runtimeEnv, location.basePath);
    expect(redirect?.headers.get("location")).toBe(`${CUSTOMER}/blog/hello`);
  });

  it("feed, sitemap, robots, and llms.txt emit customer URLs", async () => {
    const { location, request: feedRequest } = proxied("/feed.xml");
    const feed = await handleFeed(env.DB, feedRequest, runtimeEnv, location);
    const feedXml = await feed.text();
    expect(feedXml).toContain(`<link>${CUSTOMER}/blog/</link>`);
    expect(feedXml).toContain(`<link>${CUSTOMER}/blog/hello</link>`);
    expect(feedXml).toContain(`<atom:link href="${CUSTOMER}/blog/feed.xml"`);
    expect(feedXml).toContain(`https://${HOST}/media-assets/asset-`);
    expect(feedXml).not.toContain(`${CUSTOMER}/media-assets`);

    const sitemap = await handleSitemap(env.DB, request("/sitemap.xml"), runtimeEnv, location);
    const sitemapXml = await sitemap.text();
    expect(sitemapXml).toContain(`<loc>${CUSTOMER}/blog/</loc>`);
    expect(sitemapXml).toContain(`<loc>${CUSTOMER}/blog/hello</loc>`);

    const robots = await handleRobots(env.DB, request("/robots.txt"), runtimeEnv, location);
    expect(await robots.text()).toContain(`Sitemap: ${CUSTOMER}/blog/sitemap.xml`);

    const llms = await handleLlmsTxt(env.DB, request("/llms.txt"), runtimeEnv, location);
    expect(await llms.text()).toContain(`](${CUSTOMER}/blog/hello.md)`);
  });

  it("listing markdown prefixes pagination and post links with the base path", () => {
    const lines = listingMarkdown(
      {
        site: { name: "Spl Blog" },
        posts: [{ id: "p", title: "Hello", slug: "hello", excerpt: null, published_at: T, updated_at: T, tags_json: "[]", seo_description: null }],
        totalPosts: 60,
        page: 2,
        basePath: "/blog",
        indexable: true,
        listing: { kind: "index" },
        sidebar: { recent: [], tags: [] },
      } as unknown as PublicIndexLoaderData,
      `${CUSTOMER}/blog`,
    );
    expect(lines).toContain(`](${CUSTOMER}/blog/hello.md)`);
    expect(lines).toContain("[Newer](/blog)");
    expect(lines).toContain("[Older](/blog?page=3)");
  });

  it("proxied and direct requests never share a cache entry", async () => {
    const { request: proxiedReq } = proxied("/hello");
    await putArticleResponseCache(proxiedReq.url, "html", new Response("<html>proxied</html>", {
      headers: { "cache-control": "public, max-age=300", "cache-tag": "vc-site:site-spl" },
    }));
    expect(await matchArticleResponseCache(proxiedReq.url, "html")).toBeTruthy();
    expect(await matchArticleResponseCache(request("/hello").url, "html")).toBeUndefined();
  });
});

describe("analytics in proxied mode", () => {
  function viewContext(request: Request, location?: { origin: string }) {
    return {
      request,
      locals: { publicLocation: location ? { ...location, basePath: "/blog", assetOrigin: "", proxied: true } : undefined },
      params: {},
      url: new URL(request.url),
    } as never;
  }

  const payload = () => ({ method: "POST", headers: { "content-type": "application/json", origin: CUSTOMER }, body: JSON.stringify({ slug: "missing" }) });

  it("accepts the customer Origin when proxied and rejects a foreign one", async () => {
    const ok = await viewPost(viewContext(request("/api/analytics/view", payload()), { origin: CUSTOMER }));
    expect(ok.status).toBe(204);
    const foreign = await viewPost(viewContext(request("/api/analytics/view", { ...payload(), headers: { "content-type": "application/json", origin: "https://evil.example" } }), { origin: CUSTOMER }));
    expect(foreign.status).toBe(403);
    const direct403 = await viewPost(viewContext(request("/api/analytics/view", payload())));
    expect(direct403.status).toBe(403);
  });

  it("self-filters referrers against the customer host", () => {
    expect(normalizeReferrerHost("customer.example.com", "customer.example.com")).toBeNull();
    expect(normalizeReferrerHost("google.com", "customer.example.com")).toBe("google.com");
  });
});

describe("review fixes: entitlement and rewrite passes", () => {
  const freeLocation = { origin: `https://${FREE_HOST}`, basePath: "", assetOrigin: `https://${FREE_HOST}`, proxied: false };
  const freeRequest = (path: string, init?: RequestInit) =>
    new Request(`https://${FREE_HOST}${path}`, { ...init, headers: { host: FREE_HOST, ...init?.headers } });

  it("404s proxied ingress when the site's entitlement is gone", async () => {
    const path = `/_vc/p/${FREE_PROXY_ID}/hello`;
    expect(await resolvePublicLocationIngress(env.DB, freeRequest(path), path, runtimeEnv))
      .toEqual({ kind: "not-found" });
    // Self-host is always entitled: the same id resolves.
    const selfHosted = await resolvePublicLocationIngress(
      env.DB, freeRequest(path), path, { ...runtimeEnv, selfHosted: true },
    );
    expect(selfHosted).toMatchObject({ kind: "proxied", path: "/hello" });
    // The entitled site's id still resolves under the normal env.
    const entitled = `/_vc/p/${PROXY_ID}/hello`;
    expect(await resolvePublicLocationIngress(env.DB, request(entitled), entitled, runtimeEnv))
      .toMatchObject({ kind: "proxied" });
  });

  it("serves unentitled sites on their default host without redirecting to paid mounts", async () => {
    // Subpath primary: no redirect, the default host page loads instead.
    expect(await primaryLocationRedirect(env.DB, freeRequest("/hello"), "/hello", runtimeEnv, freeLocation)).toBeNull();
    // Custom-domain primary: same rule — resolveSite already 404s the custom
    // host; the default host must not 301 readers into it.
    const freeCustomRequest = new Request(`https://${FREE_CUSTOM_HOST}/post`, { headers: { host: FREE_CUSTOM_HOST } });
    expect(await primaryLocationRedirect(env.DB, freeCustomRequest, "/post", runtimeEnv, freeLocation)).toBeNull();
    // Entitled counterparts still redirect (sanity).
    const entitled = await primaryLocationRedirect(env.DB, request("/hello"), "/hello", runtimeEnv, freeLocation);
    expect(entitled?.headers.get("location")).toBe(`${CUSTOMER}/blog/hello`);
  });

  it("keeps the ingress location across an /internal rewrite pass (?q= / ?page=2 included)", async () => {
    // Pass 1: proxied blog root — the same call middleware makes.
    const first = request(`/_vc/p/${PROXY_ID}/?page=2`);
    const ingress = await resolvePublicLocationIngress(env.DB, first, new URL(first.url).pathname, runtimeEnv);
    expect(ingress).toMatchObject({ kind: "proxied", path: "/" });
    if (ingress.kind !== "proxied") return;

    // Pass 1 stores its state; pass 2 (Astro.rewrite → /internal/tenant?q=x)
    // reruns middleware with the same locals.
    const state = ingressStateForPass({ publicLocation: ingress.location, publicPath: "/" });
    expect(state).toEqual({ location: ingress.location, publicPath: "/" });
    expect(ingressStateForPass({})).toBeNull();
    expect(ingressStateForPass({ publicPath: "/" })).toBeNull();

    // Even if pass 2 canonicalized the rewritten target verbatim, /internal/*
    // is exempt — no 301 to /blog/internal/tenant.
    const second = request("/internal/tenant?q=hello&page=2");
    expect(
      await primaryLocationRedirect(env.DB, second, new URL(second.url).pathname, runtimeEnv, state!.location),
    ).toBeNull();
  });

  it("resolves post link slugs outside the 200-summary window", async () => {
    const site = await resolveSite(
      new Request("https://spl-links.basedui.dev/x", { headers: { host: "spl-links.basedui.dev" } }),
      env.DB,
      runtimeEnv,
    );
    expect(site?.id).toBe("site-spl-links");
    const location = { origin: "https://spl-links.basedui.dev", basePath: "/blog", assetOrigin: "", proxied: true };
    const blog = await loadPublicPostForSite(env.DB, location, site!, "linker", runtimeEnv);
    // `old-link-0` is the oldest of 201 posts — outside the newest-200 summary
    // set — but still published, so its link gets the base path. `/nope` isn't.
    expect(blog!.postSlugs).toEqual(new Set(["old-link-0"]));

    // The data-layer helper resolves the same candidates directly.
    const slugs = await resolvePublishedLinkSlugs(env.DB, site!.id, ["[a](/old-link-0) [b](/old-link-200) [c](/missing)"]);
    expect(slugs).toEqual(new Set(["old-link-0", "old-link-200"]));
  });
});

describe("proxied page assets and CSP (phase 2)", () => {
  const ASSET_ORIGIN = `https://${HOST}`;
  // Representative tenant HTML: Astro-injected build assets, preloads, icons.
  const PAGE_HTML = [
    `<!doctype html><html data-vc-base="/blog"><head>`,
    `<link rel="stylesheet" href="/_astro/site.ABC123.css">`,
    `<link rel="preload" href="/_astro/geist.DEF456.woff2" as="font" type="font/woff2">`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<meta property="og:image" content="${ASSET_ORIGIN}/og/hello.png?v=0123456789abcdef">`,
    `</head><body>`,
    `<a href="/blog/hello">post</a><a href="/pricing">customer pricing</a>`,
    `<script src="/_astro/page-view.GHI789.js" defer></script>`,
    `<img src="${ASSET_ORIGIN}/media-assets/asset-2">`,
    `</body></html>`,
  ].join("");

  it("rewrites root-relative worker assets and CSP on a proxied response", async () => {
    // The ingress produces the proxied location; middleware then rewrites the
    // page's asset URLs and widens the CSP before the response leaves.
    const path = `/_vc/p/${PROXY_ID}/hello`;
    const ingress = await resolvePublicLocationIngress(env.DB, request(path), path, runtimeEnv);
    if (ingress.kind !== "proxied") throw new Error("expected proxied ingress");

    // Real SSR responses carry Astro's CSP header (astro.config.mjs).
    const astroCsp = "default-src 'self'; script-src 'self' 'sha256-abc'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; manifest-src 'self'";
    const page = new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": astroCsp } });
    const rewritten = rewriteProxiedAssetsInHtml(page, ingress.location);
    const headers = new Headers(rewritten.headers);
    applyPublicSecurityHeaders("/hello", headers.get("content-type"), headers, ingress.location);
    const html = await rewritten.text();

    // Every root-relative worker asset moved to the asset origin.
    expect(html).not.toContain('="/_astro/');
    expect(html).not.toContain('="/favicon');
    expect(html).toContain(`href="${ASSET_ORIGIN}/_astro/site.ABC123.css"`);
    expect(html).toContain(`src="${ASSET_ORIGIN}/_astro/page-view.GHI789.js"`);
    expect(html).toContain(`href="${ASSET_ORIGIN}/favicon.svg"`);
    expect(html).toMatch(/<link rel="preload"[^>]*crossorigin/);
    // Blog links, author root-relative links, already-absolute assets: alone.
    expect(html).toContain('href="/blog/hello"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain(`src="${ASSET_ORIGIN}/media-assets/asset-2"`);

    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(new RegExp(`script-src [^;]*${HOST.replace(/\./g, "\\.")}`));
    expect(csp).toMatch(new RegExp(`style-src [^;]*${HOST.replace(/\./g, "\\.")}`));
    expect(csp).toMatch(new RegExp(`font-src [^;]*${HOST.replace(/\./g, "\\.")}`));
    expect(csp).toMatch(new RegExp(`img-src [^;]*${HOST.replace(/\./g, "\\.")}`));
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
    expect(csp).not.toMatch(/connect-src [^;]*basedui/);
  });

  it("leaves a direct response byte-identical and its CSP unchanged", async () => {
    const location = { origin: ASSET_ORIGIN, basePath: "", assetOrigin: ASSET_ORIGIN, proxied: false };
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    applyPublicSecurityHeaders("/hello", "text/html; charset=utf-8", headers, location);
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("_astro");
    expect(csp).toContain("script-src 'self'");
  });
});
