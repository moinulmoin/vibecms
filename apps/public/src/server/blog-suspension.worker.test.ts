/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { clearSiteSuspensionSql, suspendSiteSql } from "@vc/db";
import { handleFeed, handleLlmsTxt, handleSitemap } from "./public-feeds";
import { handlePublicPostByHostGet, isPublicBlogPaused, loadPublicPostByHost } from "./public-blog";
import { parsePublicRuntimeEnv } from "./public-url";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const runtimeEnv = parsePublicRuntimeEnv(env);
const NOW = Math.floor(Date.now() / 1000);
const SITE_ID = "site-suspended";
const HOST = "suspended.example.test";
const CUSTOM_HOST = "own.suspended.test";
const CONTENT = "Spam body that must never be served";

function requestFor(host: string, path = "/"): Request {
  return new Request(`https://${host}${path}`, { headers: { host } });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('ws-suspended', 'Suspended', 'ws-suspended', ?, ?)").bind(NOW, NOW),
    env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, 'ws-suspended', 'Suspended blog', 'suspended', ?, ?)").bind(SITE_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES ('domain-suspended', ?, ?, 'default', 'active', ?, ?)").bind(SITE_ID, HOST, NOW, NOW),
    env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES ('domain-suspended-own', ?, ?, 'custom', 'active', ?, ?)").bind(SITE_ID, CUSTOM_HOST, NOW, NOW),
    env.DB.prepare(`INSERT INTO posts (id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at)
      VALUES ('post-suspended', ?, 'Spam title', 'hello', ?, 'published', ?, 'api_key', 'seed', 'api_key', 'seed', ?, ?)`).bind(SITE_ID, CONTENT, NOW - 50, NOW - 50, NOW - 50),
    env.DB.prepare(`INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at)
      VALUES ('version-suspended', 'post-suspended', ?, 1, 'Spam title', 'hello', ?, 'published', 'api_key', 'seed', 'seed', ?)`).bind(SITE_ID, CONTENT, NOW - 50),
    env.DB.prepare("UPDATE posts SET published_version_id = 'version-suspended' WHERE id = 'post-suspended'"),
  ]);
});

describe("operator suspension on the public worker", () => {
  it("serves the paused page with noindex on every address and never the content, then serves again once cleared", async () => {
    await env.DB.prepare(suspendSiteSql(SITE_ID, "Spam", NOW)).run();

    for (const host of [HOST, CUSTOM_HOST]) {
      // The post page loader hands back the paused sentinel, so the page answers with the paused page.
      expect(isPublicBlogPaused(await loadPublicPostByHost(env.DB, requestFor(host, "/hello"), "hello", runtimeEnv))).toBe(true);

      for (const response of [
        await handlePublicPostByHostGet(env.DB, requestFor(host, "/hello.md"), "hello.md", runtimeEnv),
        await handleSitemap(env.DB, requestFor(host, "/sitemap.xml"), runtimeEnv),
        await handleFeed(env.DB, requestFor(host, "/feed.xml"), runtimeEnv),
        await handleLlmsTxt(env.DB, requestFor(host, "/llms.txt"), runtimeEnv),
      ]) {
        expect([503, 404]).toContain(response?.status);
        expect(response?.headers.get("x-robots-tag")).toContain("noindex");
        const body = await response!.text();
        expect(body).not.toContain(CONTENT);
        expect(body).not.toContain("Spam title");
      }
    }

    await env.DB.prepare(clearSiteSuspensionSql(SITE_ID)).run();

    const blog = await loadPublicPostByHost(env.DB, requestFor(HOST, "/hello"), "hello", runtimeEnv);
    expect(blog && !isPublicBlogPaused(blog) ? blog.post.content_markdown : null).toBe(CONTENT);
    const sitemap = await handleSitemap(env.DB, requestFor(HOST, "/sitemap.xml"), runtimeEnv);
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain(`https://${HOST}/hello</loc>`);
  });
});
