/// <reference types="@cloudflare/vitest-pool-workers" />
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createPost, publishPost, updatePost, type Actor } from "@vc/core";
import { createD1PostRepository } from "@vc/db";
import { handleSitemap } from "./public-feeds";
import { parsePublicRuntimeEnv } from "./public-url";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const SITE = "site-lastmod";
const HOST = "lastmod.basedui.dev";
const DAY = 86_400;
const T0 = 1_750_000_000;
const runtimeEnv = parsePublicRuntimeEnv(env);
const agent: Actor = { type: "api_key", id: "lastmod-agent", name: "Agent", scopes: ["posts:read", "posts:create", "posts:update", "posts:publish"] };
const human: Actor = { type: "human", id: "lastmod-owner", name: "Owner", role: "owner" };

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('ws-lastmod', 'Lastmod', 'ws-lastmod', 1, 1)").run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, 'ws-lastmod', 'Lastmod', 'lastmod', 1, 1)").bind(SITE).run();
  await env.DB.prepare("INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES ('dom-lastmod', ?, ?, 'default', 'active', 1, 1)").bind(SITE, HOST).run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function at(epochSeconds: number) {
  vi.spyOn(Date, "now").mockReturnValue(epochSeconds * 1000);
}

function iso(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toISOString();
}

async function lastmodOf(slug: string) {
  vi.restoreAllMocks();
  const response = await handleSitemap(env.DB, new Request("https://" + HOST + "/sitemap.xml", { headers: { host: HOST } }), runtimeEnv);
  const xml = await response.text();
  const match = new RegExp("<loc>https://" + HOST + "/" + slug + "</loc><lastmod>([^<]+)</lastmod>").exec(xml);
  return match?.[1] ?? null;
}

describe("sitemap lastmod", () => {
  it("moves when the live page changes and stays put otherwise", async () => {
    const repo = createD1PostRepository(env.DB);
    at(T0);
    const post = await createPost(repo, agent, { siteId: SITE, title: "Lastmod", slug: "lastmod-post", contentMarkdown: "First body." }, "active");
    at(T0 + 2 * DAY);
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: 1, billingStatus: "active" });
    expect(await lastmodOf("lastmod-post")).toBe(iso(T0 + 2 * DAY));

    // A draft edit on a live post changes nothing public.
    at(T0 + 4 * DAY);
    const draft = await updatePost(repo, human, { siteId: SITE, postId: post.id, expectedVersionNumber: 1, contentMarkdown: "Second body." });
    expect(await lastmodOf("lastmod-post")).toBe(iso(T0 + 2 * DAY));

    // Publishing that edit days later changes the page at publish time.
    at(T0 + 6 * DAY);
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: draft.versionNumber, billingStatus: "active" });
    expect(await lastmodOf("lastmod-post")).toBe(iso(T0 + 6 * DAY));

    // An agent re-save with no changes, then publishing it, renders the same page.
    at(T0 + 8 * DAY);
    const resaved = await updatePost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: draft.versionNumber });
    expect(resaved.versionNumber).toBeGreaterThan(draft.versionNumber);
    at(T0 + 9 * DAY);
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: resaved.versionNumber, billingStatus: "active" });
    expect(await lastmodOf("lastmod-post")).toBe(iso(T0 + 6 * DAY));

    // Re-approving the version that is already live is a no-op.
    at(T0 + 10 * DAY);
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: resaved.versionNumber, billingStatus: "active" });
    expect(await lastmodOf("lastmod-post")).toBe(iso(T0 + 6 * DAY));

    // A metadata-only change (SEO description) alters the rendered page.
    at(T0 + 12 * DAY);
    const seo = await updatePost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: resaved.versionNumber, seoDescription: "A sharper summary." });
    at(T0 + 13 * DAY);
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: seo.versionNumber, billingStatus: "active" });
    expect(await lastmodOf("lastmod-post")).toBe(iso(T0 + 13 * DAY));
  });
it("moves for a second substantive publish on the same day", async () => {
    const repo = createD1PostRepository(env.DB);
    const T1 = T0 + 30 * DAY;
    at(T1);
    const post = await createPost(repo, agent, { siteId: SITE, title: "Same day", slug: "same-day-post", contentMarkdown: "Morning body." }, "active");
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: 1, billingStatus: "active" });
    expect(await lastmodOf("same-day-post")).toBe(iso(T1));
    at(T1 + 3_600);
    const edited = await updatePost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: 1, contentMarkdown: "Afternoon body." });
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: edited.versionNumber, billingStatus: "active" });
    expect(await lastmodOf("same-day-post")).toBe(iso(T1 + 3_600));
  });

  it("does not move when a blank SEO field saved as empty text is re-saved as no value", async () => {
    const repo = createD1PostRepository(env.DB);
    const T2 = T0 + 40 * DAY;
    at(T2);
    const post = await createPost(repo, agent, { siteId: SITE, title: "Blank", slug: "blank-seo-post", contentMarkdown: "Body.", seoDescription: "" }, "active");
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: 1, billingStatus: "active" });
    at(T2 + 2 * DAY);
    const resaved = await updatePost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: 1, seoDescription: "" });
    expect(resaved.versionNumber).toBe(2);
    expect((await repo.getPostVersion(SITE, post.id, 1))?.seoDescription).toBe("");
    expect((await repo.getPostVersion(SITE, post.id, 2))?.seoDescription).toBeNull();
    await publishPost(repo, agent, { siteId: SITE, postId: post.id, expectedVersionNumber: 2, billingStatus: "active" });
    expect(await lastmodOf("blank-seo-post")).toBe(iso(T2));
  });
});
