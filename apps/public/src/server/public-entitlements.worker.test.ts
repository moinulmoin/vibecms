/// <reference types="@cloudflare/vitest-pool-workers" />

import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import {
  createDataAccess,
  type ManagedFirstProvisionInput,
} from "@vc/db";
import { POST as analyticsPost } from "../pages/api/analytics/view";
import { buildPostHeadContent } from "../lib/seo-meta";
import { handleFeed, handleLlmsTxt, handleRobots, handleSitemap } from "./public-feeds";
import {
  handlePublicPostByHostGet,
  loadPublicPostByHost,
} from "./public-blog";
import { parsePublicRuntimeEnv } from "./public-url";
import { isPublicBlogIndexable, resolveSite } from "./public-blog-data";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const data = createDataAccess(env.DB);
const runtimeEnv = parsePublicRuntimeEnv(env);
const NOW = Math.floor(Date.now() / 1000);
const SITE_ID = "site-public-entitlement";
const WORKSPACE_ID = "workspace-public-entitlement";
const DEFAULT_HOST = "public-entitlement.example.test";
const CUSTOM_HOST = "custom-entitlement.example.test";
const FULL_SCOPES = JSON.stringify([
  "sites:read",
  "posts:read",
  "posts:create",
  "posts:update",
  "posts:publish",
  "posts:archive",
  "assets:write",
  "activity:read",
]);

function requestFor(host: string, path = "/"): Request {
  return new Request(`https://${host}${path}`, {
    headers: { host },
  });
}

function provisionInput(): ManagedFirstProvisionInput {
  return {
    timestamp: NOW - 100,
    owner: {
      id: "user-public-entitlement",
      name: "Public Entitlement Owner",
      email: "public-entitlement@example.test",
    },
    workspace: {
      id: WORKSPACE_ID,
      name: "Public Entitlement Workspace",
      slug: "public-entitlement-workspace",
    },
    membership: { id: "membership-public-entitlement" },
    site: {
      id: SITE_ID,
      name: "Public Entitlement",
      slug: "public-entitlement",
      description: "A public entitlement fixture.",
    },
    defaultDomain: {
      id: "domain-public-entitlement-default",
      hostname: DEFAULT_HOST,
    },
    apiKey: {
      id: "key-public-entitlement",
      name: "AutoSEOPilot",
      tokenPrefix: "vc_test_public_entitlement",
      tokenHash: "hash-public-entitlement",
      scopesJson: FULL_SCOPES,
      actorName: "AutoSEOPilot",
    },
    binding: {
      id: "binding-public-entitlement",
      externalWorkspaceId: "external-public-entitlement",
      credentialId: "credential-public-entitlement",
      credentialGeneration: 1,
      entitlementStatus: "active",
      entitlementExpiresAt: null,
      lifecycleRevision: 1,
    },
  };
}

async function setManagedEntitlement(
  status: "active" | "revoked",
  expiresAt: number | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE autoseopilot_managed_sites
     SET entitlement_status = ?, entitlement_expires_at = ?, revoked_at = ?, updated_at = ?
     WHERE site_id = ?`,
  )
    .bind(status, expiresAt, status === "revoked" ? NOW : null, NOW, SITE_ID)
    .run();
}

async function setPolar(status: "active" | "none", currentPeriodEnd: number | null): Promise<void> {
  await env.DB.prepare(
    "UPDATE billing_customers SET status = ?, current_period_end = ?, updated_at = ? WHERE workspace_id = ?",
  )
    .bind(status, currentPeriodEnd, NOW, WORKSPACE_ID)
    .run();
}

async function seedPost(): Promise<void> {
  const postId = "post-public-entitlement";
  const versionId = "version-public-entitlement";
  const columns =
    "id, site_id, title, slug, content_markdown, status, published_at, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at";
  await env.DB.prepare(`INSERT INTO posts (${columns}) VALUES (?, ?, ?, ?, ?, 'published', ?, 'api_key', 'public-entitlement', 'api_key', 'public-entitlement', ?, ?)`)
    .bind(postId, SITE_ID, "Entitlement post", "hello", "# Entitlement post", NOW - 50, NOW - 50, NOW - 50)
    .run();
  await env.DB.prepare(
    "INSERT INTO post_versions (id, post_id, site_id, version_number, title, slug, content_markdown, status, created_by_type, created_by_id, change_summary, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, 'published', 'api_key', 'public-entitlement', 'seed', ?)",
  )
    .bind(versionId, postId, SITE_ID, "Entitlement post", "hello", "# Entitlement post", NOW - 50)
    .run();
  await env.DB.prepare("UPDATE posts SET published_version_id = ? WHERE id = ?").bind(versionId, postId).run();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await data.managedSites.firstProvision(provisionInput());
  await env.DB.prepare(
    "INSERT INTO billing_customers (id, workspace_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, 'none', NULL, ?, ?)",
  )
    .bind("billing-public-entitlement", WORKSPACE_ID, NOW, NOW)
    .run();
  await env.DB.prepare(
    "INSERT INTO domains (id, site_id, hostname, type, status, created_at, updated_at) VALUES (?, ?, ?, 'custom', 'active', ?, ?)",
  )
    .bind("domain-public-entitlement-custom", SITE_ID, CUSTOM_HOST, NOW, NOW)
    .run();
  await seedPost();
});

beforeEach(async () => {
  await setManagedEntitlement("active", null);
  await setPolar("none", null);
});

function analyticsContext(
  host: string,
  publicEnv = runtimeEnv,
  headers: Record<string, string> = {},
): APIContext {
  const request = new Request(`https://${host}/api/analytics/view`, {
    method: "POST",
    headers: {
      host,
      origin: `https://${host}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ slug: "hello" }),
  });
  return { request, locals: { publicEnv } } as unknown as APIContext;
}

describe("public effective entitlement resolution", () => {
  it("serves managed active sites on default and custom domains and carries raw Polar fields", async () => {
    const defaultSite = await resolveSite(requestFor(DEFAULT_HOST), env.DB, runtimeEnv);
    const customSite = await resolveSite(requestFor(CUSTOM_HOST), env.DB, runtimeEnv);

    expect(defaultSite).toMatchObject({
      id: SITE_ID,
      billing_status: "none",
      current_period_end: null,
      resolved_domain_type: "default",
      effective_entitlement: {
        effective: true,
        access: "hosted_paid",
        activeSources: ["managed_sponsorship"],
      },
    });
    expect(customSite).toMatchObject({
      id: SITE_ID,
      resolved_domain_type: "custom",
      effective_entitlement: { effective: true },
    });
    expect(isPublicBlogIndexable(defaultSite!, runtimeEnv)).toBe(true);
  });

  it("serves expired sponsorship content on the default host but denies custom domains", async () => {
    const expiration = NOW + 100;
    await setManagedEntitlement("active", expiration);
    const exactExpiry = await data.managedSites.resolveSite(SITE_ID, {
      selfHosted: false,
      now: expiration,
    });
    expect(exactExpiry).toMatchObject({ effective: false, access: "hosted_free" });

    await setManagedEntitlement("active", Math.floor(Date.now() / 1000) - 1);
    const defaultSite = await resolveSite(requestFor(DEFAULT_HOST), env.DB, runtimeEnv);
    const customSite = await resolveSite(requestFor(CUSTOM_HOST), env.DB, runtimeEnv);

    expect(defaultSite).toMatchObject({
      resolved_domain_type: "default",
      effective_entitlement: { effective: false, access: "hosted_free", activeSources: [] },
    });
    expect(customSite).toBeNull();
  });

  it("denies revoked custom domains while an independent Polar subscription restores access", async () => {
    await setManagedEntitlement("revoked", null);
    expect(await resolveSite(requestFor(DEFAULT_HOST), env.DB, runtimeEnv)).toMatchObject({
      effective_entitlement: { effective: false },
    });
    expect(await resolveSite(requestFor(CUSTOM_HOST), env.DB, runtimeEnv)).toBeNull();

    await setPolar("active", NOW + 100);
    const customSite = await resolveSite(requestFor(CUSTOM_HOST), env.DB, runtimeEnv);
    expect(customSite).toMatchObject({
      billing_status: "active",
      current_period_end: NOW + 100,
      effective_entitlement: {
        effective: true,
        access: "hosted_paid",
        activeSources: ["polar"],
        effectiveUntil: NOW + 100,
      },
    });
  });

  it("keeps free default output readable but disables indexing, sitemap, and feed discovery", async () => {
    await setManagedEntitlement("revoked", null);

    const site = await resolveSite(requestFor(DEFAULT_HOST), env.DB, runtimeEnv);
    expect(site).toMatchObject({ effective_entitlement: { effective: false } });
    const blog = await loadPublicPostByHost(env.DB, requestFor(DEFAULT_HOST, "/hello"), "hello", runtimeEnv);
    expect(blog).toMatchObject({ indexable: false, site: { effective_entitlement: { effective: false } } });

    const head = buildPostHeadContent({
      post: blog!.post,
      site: blog!.site,
      canonicalUrl: blog!.canonicalUrl,
      origin: blog!.origin,
      indexable: blog!.indexable,
    });
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex,nofollow" });

    const markdown = await handlePublicPostByHostGet(
      env.DB,
      requestFor(DEFAULT_HOST, "/hello?format=md"),
      "hello",
      runtimeEnv,
    );
    expect(markdown?.status).toBe(200);
    expect(markdown?.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const sitemap = await handleSitemap(env.DB, requestFor(DEFAULT_HOST, "/sitemap.xml"), runtimeEnv);
    expect(sitemap.status).toBe(404);

    const robots = await handleRobots(env.DB, requestFor(DEFAULT_HOST, "/robots.txt"), runtimeEnv);
    expect(await robots.text()).not.toContain("Sitemap:");
    expect(robots.headers.get("cache-tag")).toBe(`vc-site:${SITE_ID}`);

    const feed = await handleFeed(env.DB, requestFor(DEFAULT_HOST, "/feed.xml"), runtimeEnv);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const llms = await handleLlmsTxt(env.DB, requestFor(DEFAULT_HOST, "/llms.txt"), runtimeEnv);
    expect(llms.status).toBe(200);
    expect(llms.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await llms.text()).toContain("Entitlement post");
  });

  it("preserves marketing-host isolation for product output", async () => {
    const sitemap = await handleSitemap(env.DB, requestFor(runtimeEnv.publicBlogDomain!, "/sitemap.xml"), runtimeEnv);
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain(`${runtimeEnv.appUrl}/docs`.replace(runtimeEnv.appUrl, "https://basedui.dev"));

    const robots = await handleRobots(env.DB, requestFor(runtimeEnv.publicBlogDomain!, "/robots.txt"), runtimeEnv);
    expect(await robots.text()).toContain("Sitemap:");

    const llms = await handleLlmsTxt(env.DB, requestFor(runtimeEnv.publicBlogDomain!, "/llms.txt"), runtimeEnv);
    expect(await llms.text()).toContain("# vibecms");
  });

  it("treats self-hosted sites as effective without mutating managed lifecycle state", async () => {
    await setManagedEntitlement("revoked", null);
    const before = await env.DB.prepare(
      "SELECT entitlement_status, entitlement_expires_at, lifecycle_revision, updated_at FROM autoseopilot_managed_sites WHERE site_id = ?",
    )
      .bind(SITE_ID)
      .first();

    const selfHostedEnv = { ...runtimeEnv, selfHosted: true };
    const site = await resolveSite(requestFor("self-hosted.example.test"), env.DB, selfHostedEnv);
    expect(site).toMatchObject({
      effective_entitlement: {
        effective: true,
        access: "self_hosted",
        activeSources: ["self_hosted"],
      },
    });
    expect(isPublicBlogIndexable(site!, selfHostedEnv)).toBe(true);

    const after = await env.DB.prepare(
      "SELECT entitlement_status, entitlement_expires_at, lifecycle_revision, updated_at FROM autoseopilot_managed_sites WHERE site_id = ?",
    )
      .bind(SITE_ID)
      .first();
    expect(after).toEqual(before);
  });
});

describe("public analytics effective entitlement gate", () => {
  const writeDataPoint = vi.fn();

  beforeEach(() => {
    writeDataPoint.mockReset();
    (env as unknown as Record<string, unknown>).ANALYTICS = { writeDataPoint };
  });

  it("records managed and Polar-entitled views but not free, expired, or privacy-opted views", async () => {
    const managed = await analyticsPost(analyticsContext(DEFAULT_HOST));
    expect(managed.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);

    writeDataPoint.mockReset();
    await setManagedEntitlement("active", Math.floor(Date.now() / 1000) - 1);
    const expired = await analyticsPost(analyticsContext(DEFAULT_HOST));
    expect(expired.status).toBe(204);
    expect(writeDataPoint).not.toHaveBeenCalled();

    await setManagedEntitlement("revoked", null);
    await setPolar("active", NOW + 100);
    const polar = await analyticsPost(analyticsContext(DEFAULT_HOST));
    expect(polar.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);

    writeDataPoint.mockReset();
    await setPolar("none", null);
    const free = await analyticsPost(analyticsContext(DEFAULT_HOST));
    expect(free.status).toBe(204);
    expect(writeDataPoint).not.toHaveBeenCalled();

    await setManagedEntitlement("active", null);
    const privateView = await analyticsPost(analyticsContext(DEFAULT_HOST, runtimeEnv, { dnt: "1" }));
    expect(privateView.status).toBe(204);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("keeps analytics disabled in self-hosted mode", async () => {
    const selfHostedEnv = { ...runtimeEnv, selfHosted: true };
    const response = await analyticsPost(analyticsContext(DEFAULT_HOST, selfHostedEnv));
    expect(response.status).toBe(204);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});
