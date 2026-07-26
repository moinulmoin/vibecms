/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { parsePublicRuntimeEnv } from "./public-url";
import { resolveSite } from "./public-blog-data";
import {
  handlePublicPostByHostGet,
  loadPublicPostByHost,
  matchCachedPublicPostHtml,
  publicHtmlResponseHeaders,
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
    expect(real?.post.slug).toBe("hello");
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
            },
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
    const cachedHtml = await matchCachedPublicPostHtml(new Request(url, { headers }));
    expect(cachedHtml).toBeDefined();
    const cachedHtmlNotModified = await matchCachedPublicPostHtml(
      new Request(url, {
        headers: { ...headers, "if-none-match": cachedHtml!.headers.get("etag")! },
      }),
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
    expect(body).toContain("# Hello");
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
