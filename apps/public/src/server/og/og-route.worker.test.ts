/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeAll, describe, expect, inject, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import type { APIContext } from "astro";
import { parsePublicRuntimeEnv } from "../public-url";

// In-memory stand-in for ASSETS_BUCKET (the test worker has no R2 binding).
const r2 = new Map<string, { bytes: ArrayBuffer; version: string | undefined }>();
const fakeBucket = {
  async get(key: string) {
    const hit = r2.get(key);
    return hit ? { customMetadata: { version: hit.version }, arrayBuffer: async () => hit.bytes } : null;
  },
  async put(key: string, value: Uint8Array | ArrayBuffer, options?: { customMetadata?: Record<string, string> }) {
    const bytes = value instanceof Uint8Array ? value.slice().buffer : value.slice(0);
    r2.set(key, { bytes, version: options?.customMetadata?.version });
  },
};

vi.mock("../runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime")>()),
  publicAssetsBucket: () => fakeBucket,
}));

const { handleOgCardRequest } = await import("./og-route");

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const ts = 1_700_000_000;
const publicEnv = parsePublicRuntimeEnv(env);

async function seedSite(id: string, host: string, name: string) {
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(`ws-${id}`, name, `ws-${id}`, ts, ts).run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, `ws-${id}`, name, id, ts, ts).run();
  await env.DB.prepare("INSERT INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)")
    .bind(`bc-${id}`, `ws-${id}`, ts, ts).run();
  await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'active', ?, ?)")
    .bind(`domain-${id}`, id, host, ts, ts).run();
}

async function seedPost(siteId: string, slug: string, publishedAt: number, status = "published") {
  const postId = `post-${siteId}-${slug}`;
  const columns = "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
  await env.DB.prepare(`INSERT INTO posts (${columns}) VALUES (?, ?, ?, ?, '# Hi', ?, ?, 'human', 'u', 'human', 'u', ?, ?)`)
    .bind(postId, siteId, `Post ${slug}`, slug, status, publishedAt, ts, ts).run();
  const versionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at) VALUES (?, ?, ?, 1, ?, ?, '# Hi', ?, 'human', 'u', 'seed', ?)",
  ).bind(versionId, postId, siteId, `Post ${slug}`, slug, status, ts).run();
  await env.DB.prepare("UPDATE posts SET published_version_id = ? WHERE id = ?").bind(versionId, postId).run();
}

function context(url: string): APIContext {
  const request = new Request(url, { headers: { host: new URL(url).host } });
  return { request, locals: { publicEnv }, params: {} } as unknown as APIContext;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await seedSite("site-og-a", "a.og.example.com", "Alpha");
  await seedSite("site-og-b", "b.og.example.com", "Beta");
  await seedPost("site-og-a", "shared", ts);
  await seedPost("site-og-a", "only-a", ts);
  await seedPost("site-og-a", "later", Math.floor(Date.now() / 1000) + 86_400);
  await seedPost("site-og-a", "draft", ts, "draft");
  await seedPost("site-og-b", "shared", ts);
});

describe("share card route", () => {
  it("renders a published post's card and stores it under the site's own R2 key", async () => {
    const res = await handleOgCardRequest(context("https://a.og.example.com/og/shared.png"), "shared");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(r2.has("og/site-og-a/shared.png")).toBe(true);
    // An unversioned or wrong ?v= never earns the year-long immutable header.
    expect(res.headers.get("cache-control")).toContain("max-age=300");
  }, 60_000);

  it("never serves another tenant's card for the same slug", async () => {
    await handleOgCardRequest(context("https://a.og.example.com/og/shared.png"), "shared");
    const res = await handleOgCardRequest(context("https://b.og.example.com/og/shared.png"), "shared");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-tag")).toContain("vc-site:site-og-b");
    expect(res.headers.get("cache-tag")).not.toContain("site-og-a");
    expect(r2.has("og/site-og-b/shared.png")).toBe(true);
    expect(res.headers.get("etag")).not.toBe(
      (await handleOgCardRequest(context("https://a.og.example.com/og/shared.png"), "shared")).headers.get("etag"),
    );
  }, 60_000);

  it("404s posts from other sites, scheduled, drafts, and malformed slugs without rendering", async () => {
    const before = r2.size;
    for (const slug of ["only-a", "nope"]) {
      expect((await handleOgCardRequest(context(`https://b.og.example.com/og/${slug}.png`), slug)).status).toBe(404);
    }
    for (const slug of ["later", "draft", "Bad_Slug", "../x"]) {
      expect((await handleOgCardRequest(context(`https://a.og.example.com/og/x.png`), slug)).status).toBe(404);
    }
    expect((await handleOgCardRequest(context("https://unknown.og.example.com/og.png"), undefined)).status).toBe(404);
    expect(r2.size).toBe(before);
  });

  it("ignores attacker-chosen ?v= values for cache keys (no extra renders)", async () => {
    const first = await handleOgCardRequest(context("https://a.og.example.com/og.png"), undefined);
    const version = first.headers.get("etag")?.replace(/^"og-|"$/g, "");
    const writes = r2.size;
    const random = await handleOgCardRequest(context("https://a.og.example.com/og.png?v=deadbeef"), undefined);
    expect(random.headers.get("cache-control")).toContain("max-age=300");
    const exact = await handleOgCardRequest(context(`https://a.og.example.com/og.png?v=${version}`), undefined);
    expect(exact.headers.get("cache-control")).toContain("immutable");
    expect(r2.size).toBe(writes);
  }, 60_000);
});
