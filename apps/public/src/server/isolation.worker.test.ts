/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { parsePublicRuntimeEnv } from "./public-url";
import { resolveSite } from "./public-blog-data";
import { handlePublicPostByHostGet, loadPublicPostByHost } from "./public-blog";

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
