/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicBlogPostView } from "../components/PublicBlogPages";
import { buildPostHeadContent } from "../lib/seo-meta";
import { buildRssXml, buildSitemapXml } from "./public-feeds-xml";
import { parsePublicRuntimeEnv } from "./public-url";
import { listPublishedPostPage, listPublishedPostsForFeed, resolveSite, type SiteRow } from "./public-blog-data";
import {
  handlePublicPostByHostGet,
  isPublicBlogPaused,
  loadPublicPostByHost,
  matchCachedPublicPostHtml,
  publicHtmlResponseHeaders,
  publicMissingRedirect,
} from "./public-blog";
import { articleCacheTags, contentEtag, putArticleResponseCache } from "./public-blog-cache";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const runtimeEnv = parsePublicRuntimeEnv(env);

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
  const ts = 1_700_000_000;
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("ws-public-isolation", "Public Isolation", "public-isolation", ts, ts).run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind("site-public-isolation", "ws-public-isolation", "Public Isolation", "public-isolation", ts, ts).run();
  await env.DB.prepare("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)")
    .bind("bc-public-isolation", "ws-public-isolation", ts, ts).run();
  await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'active', ?, ?)")
    .bind("domain-public-isolation", "site-public-isolation", "posts.public.example.com", ts, ts).run();
  const columns = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
  await env.DB.prepare(`INSERT INTO posts (${columns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'public-test', 'api_key', 'public-test', ?, ?)`)
    .bind("post-public-hello", "site-public-isolation", "Hello", "hello", "# Hello", ts, ts, ts).run();
  await env.DB.prepare(`INSERT INTO posts (${columns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'public-test', 'api_key', 'public-test', ?, ?)`)
    .bind("post-public-api", "site-public-isolation", "Api", "api", "# Api", ts, ts, ts).run();
  for (const row of [
    { id: "post-public-hello", title: "Hello", slug: "hello", body: "# Hello" },
    { id: "post-public-api", title: "Api", slug: "api", body: "# Api" },
  ]) {
    const versionId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 'public-test', 'seed', ?)",
    ).bind(versionId, row.id, "site-public-isolation", row.title, row.slug, row.body, ts).run();
    await env.DB.prepare("UPDATE posts SET published_version_id = ? WHERE id = ?").bind(versionId, row.id).run();
  }
});

describe("public site identity", () => {
  it("loads the favicon and links for tenant pages", async () => {
    await env.DB.prepare("UPDATE sites SET favicon_asset_id = ?, logo_asset_id = ?, nav_links_json = ?, social_links_json = ? WHERE id = ?")
      .bind("favicon-public", "logo-public", JSON.stringify([{ label: "About", url: "/about" }]), JSON.stringify([{ kind: "github", url: "https://github.com/example" }]), "site-public-isolation").run();
    const site = await resolveSite(new Request("https://posts.public.example.com/", { headers: { host: "posts.public.example.com" } }), env.DB, runtimeEnv);
    expect(site).toMatchObject({ favicon_asset_id: "favicon-public", logo_asset_id: "logo-public", nav_links: [{ label: "About", url: "/about" }], social_links: [{ kind: "github" }] });
  });
});

describe("public domain resolution", () => {
  it("serves an active custom domain but not pending domains", async () => {
    const active = await resolveSite(new Request("https://posts.public.example.com/", { headers: { host: "posts.public.example.com" } }), env.DB, runtimeEnv);
    expect(active?.id).toBe("site-public-isolation");
    const pending = await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'pending', ?, ?)")
      .bind("domain-public-pending", "site-public-isolation", "pending.public.example.com", 1_700_000_001, 1_700_000_001).run();
    expect(pending.success).toBe(true);
    const notServed = await resolveSite(new Request("https://pending.public.example.com/", { headers: { host: "pending.public.example.com" } }), env.DB, runtimeEnv);
    expect(notServed).toBeNull();
  });
});

describe("public reserved-root rendering", () => {
  it("never serves reserved slugs, including markdown requests", async () => {
    const headers = { host: "posts.public.example.com" };
    expect(await loadPublicPostByHost(env.DB, new Request("https://posts.public.example.com/api", { headers }), "api", runtimeEnv)).toBeNull();
    expect(await loadPublicPostByHost(env.DB, new Request("https://posts.public.example.com/api.md", { headers }), "api.md", runtimeEnv)).toBeNull();
    const real = await loadPublicPostByHost(env.DB, new Request("https://posts.public.example.com/hello", { headers }), "hello", runtimeEnv);
    expect(isPublicBlogPaused(real) ? null : real?.post.slug).toBe("hello");
    const markdown = await handlePublicPostByHostGet(env.DB, new Request("https://posts.public.example.com/api?format=md", { headers }), "api", runtimeEnv);
    expect(markdown).toBeNull();
  });
});

describe("Accept markdown after HTML response cache", () => {
  it("returns text/markdown for Accept after HTML was cached for the same canonical URL", async () => {
    const headers = { host: "posts.public.example.com" };
    const url = "https://posts.public.example.com/hello";

    // First request path: cache the HTML representation for the canonical URL.
    await putArticleResponseCache(
      url,
      "html",
      new Response("<html>hello-html</html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          ...publicHtmlResponseHeaders(
            {
              id: "site-public-isolation",
              workspace_id: "ws-public-isolation",
              name: "Public Isolation",
              slug: "public-isolation",
              theme: "editorial",
              theme_accent: null,
              theme_font: null,
              theme_mode: "system",
              theme_radius: null,
              theme_width: null,
  theme_chrome: null,
  theme_index: null,
  theme_header: null,
              byline_name: null,
              show_agent_credit: true,
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
                managedSponsorship: { status: null, expiresAt: null, active: false, revokedAt: null },
                claim: null,
                servingAllowed: true,
                servingPaused: false,
              },
            } satisfies SiteRow,
            runtimeEnv,
            articleCacheTags("site-public-isolation", "hello"),
            {
              markdownAlternateHref: "https://posts.public.example.com/hello.md",
              etag: await contentEtag("<html>hello-html</html>"),
            },
          ),
        },
      }),
    );
    const cachedHtml = await matchCachedPublicPostHtml(
      new Request(url, { headers }),
      "site-public-isolation",
    );
    expect(cachedHtml).toBeDefined();
    expect(
      await matchCachedPublicPostHtml(
        new Request(url, { headers }),
        "site-after-host-reassignment",
      ),
    ).toBeUndefined();
    const cachedHtmlNotModified = await matchCachedPublicPostHtml(
      new Request(url, {
        headers: { ...headers, "if-none-match": cachedHtml!.headers.get("etag")! },
      }),
      "site-public-isolation",
    );
    expect(cachedHtmlNotModified?.status).toBe(304);

    // Routing boundary: markdown negotiation runs before HTML page-cache lookup.
    const markdown = await handlePublicPostByHostGet(
      env.DB,
      new Request(url, { headers: { ...headers, accept: "text/markdown" } }),
      "hello",
      runtimeEnv,
    );
    expect(markdown).toBeTruthy();
    expect(markdown!.headers.get("content-type")).toContain("text/markdown");
    expect(markdown!.headers.get("vary")).toBe("Accept");
    expect(markdown!.headers.get("link")).toContain('rel="alternate"');
    expect(markdown!.headers.get("link")).toContain("text/markdown");
    expect(markdown!.headers.get("etag")).toBeTruthy();
    const body = await markdown!.text();
    expect(body.match(/^# Hello$/gm)).toHaveLength(1);
    expect(body.endsWith("---\n\n# Hello\n")).toBe(true);
    expect(body).not.toContain("hello-html");

    const markdownNotModified = await handlePublicPostByHostGet(
      env.DB,
      new Request(url, {
        headers: {
          ...headers,
          accept: "text/markdown",
          "if-none-match": markdown!.headers.get("etag")!,
        },
      }),
      "hello",
      runtimeEnv,
    );
    expect(markdownNotModified?.status).toBe(304);

    // Explicit .md and ?format=md remain available.
    const bySuffix = await handlePublicPostByHostGet(
      env.DB,
      new Request(`${url}.md`, { headers }),
      "hello.md",
      runtimeEnv,
    );
    expect(bySuffix!.headers.get("content-type")).toContain("text/markdown");

    const byQuery = await handlePublicPostByHostGet(
      env.DB,
      new Request(`${url}?format=md`, { headers }),
      "hello",
      runtimeEnv,
    );
    expect(byQuery!.headers.get("content-type")).toContain("text/markdown");
  });
});

describe("imported publication dates and old links", () => {
  it("shows and orders the original date without changing visibility, update labels, or sitemap lastmod", async () => {
    const real = 1_700_000_000;
    const original = 1_262_304_000;
    const future = Math.floor(Date.now() / 1000) + 86_400;
    for (const row of [
      { id: "imported", slug: "imported", published: real, original, updated: real },
      { id: "normal-post", slug: "normal-post", published: real, original: null, updated: real + 100_000 },
      { id: "future-import", slug: "future-import", published: future, original, updated: future },
    ]) {
      await env.DB.prepare("INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, original_published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'published', ?, ?, 'api_key', 'public-test', 'api_key', 'public-test', ?, ?)")
        .bind(row.id, "site-public-isolation", row.slug, row.slug, "# Imported", row.published, row.original, row.published, row.published).run();
      await env.DB.prepare("INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, tags_json, status, created_by_type, created_by_id, change_summary, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'published', 'api_key', 'public-test', 'seed', ?)")
        .bind(`${row.id}-version`, row.id, "site-public-isolation", row.slug, row.slug, "# Imported", '["imports"]', row.updated).run();
      await env.DB.prepare("UPDATE posts SET published_version_id = ? WHERE id = ?").bind(`${row.id}-version`, row.id).run();
    }
    const headers = { host: "posts.public.example.com" };
    const request = new Request("https://posts.public.example.com/imported", { headers });
    const data = await loadPublicPostByHost(env.DB, request, "imported", runtimeEnv);
    expect(data && !isPublicBlogPaused(data)).toBe(true);
    if (!data || isPublicBlogPaused(data)) throw new Error("Imported post was not loaded");
    expect(data.post.published_at).toBe(original);
    const html = renderToStaticMarkup(createElement(PublicBlogPostView, { data }));
    expect(html).toContain("2010");
    expect(html).not.toContain("Updated");
    const head = buildPostHeadContent({ post: data.post, site: data.site, origin: data.origin, canonicalUrl: data.canonicalUrl, indexable: data.indexable, generatedCards: false });
    const originalIso = new Date(original * 1000).toISOString();
    expect(head.meta).toContainEqual({ property: "article:published_time", content: originalIso });
    expect(JSON.parse(head.scripts[0]!.children).datePublished).toBe(originalIso);
    const markdown = await handlePublicPostByHostGet(env.DB, new Request(request.url, { headers: { ...headers, accept: "text/markdown" } }), "imported", runtimeEnv);
    expect(await markdown!.text()).toContain(`date: ${originalIso}`);
    const page = await listPublishedPostPage(env.DB, data.site.id, 1, 20);
    expect(page.posts.map((post) => post.slug)).not.toContain("future-import");
    expect(page.posts.findIndex((post) => post.slug === "hello")).toBeLessThan(page.posts.findIndex((post) => post.slug === "imported"));
    const tagPage = await listPublishedPostPage(env.DB, data.site.id, 1, 20, "imports");
    expect(tagPage.posts.map((post) => post.slug)).toEqual(["normal-post", "imported"]);
    const feedPosts = await listPublishedPostsForFeed(env.DB, data.site.id);
    const rss = buildRssXml(data.site, data.origin, feedPosts, `${data.origin}/feed.xml`, () => "");
    expect(rss).toContain(new Date(original * 1000).toUTCString());
    const normalItem = rss.split("<item>").find((item) => item.includes("<title>normal-post</title>"));
    expect(normalItem).toContain(new Date((real + 100_000) * 1000).toUTCString());
    const sitemap = buildSitemapXml(data.origin, [data.post]);
    expect(sitemap).toContain(new Date(real * 1000).toISOString().slice(0, 10));
  });

  it("redirects missing old paths for GET and HEAD at direct and subpath locations, but never replaces a real page", async () => {
    await env.DB.prepare("INSERT INTO site_redirects (id, site_id, from_path, to_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("import-old-link", "site-public-isolation", "/2019/old", "/hello", 1_700_000_000, 1_700_000_000).run();
    const headers = { host: "posts.public.example.com" };
    for (const method of ["GET", "HEAD"]) {
      const request = new Request("https://posts.public.example.com/2019/OLD/", { headers, method });
      for (const location of [
        { origin: "https://posts.public.example.com", basePath: "", assetOrigin: "https://posts.public.example.com", proxied: false },
        { origin: "https://customer.example", basePath: "/blog", assetOrigin: "https://posts.public.example.com", proxied: true },
      ]) {
        const response = await publicMissingRedirect(env.DB, request, new Response(null, { status: 404 }), "/2019/OLD/", location, runtimeEnv);
        expect(response?.status).toBe(301);
        expect(response?.headers.get("location")).toBe(`${location.origin}${location.basePath}/hello`);
        expect(response?.headers.get("cache-control")).toBe("no-cache");
        expect(response?.headers.get("cdn-cache-control")).toBe("public, max-age=300");
        expect(response?.headers.get("cache-tag")).toBe("vc-site:site-public-isolation");
        expect(await publicMissingRedirect(env.DB, request, new Response("real page"), "/2019/OLD/", location, runtimeEnv)).toBeNull();
      }
    }
  });
});
