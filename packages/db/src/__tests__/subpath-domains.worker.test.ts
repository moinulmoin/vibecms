/**
 * Subpath-domain repository contracts under real miniflare D1 (plans/022 slice A).
 *
 * Covers the `subpath` row lifecycle the proxy ingress depends on:
 *   - insertSubpath creates a pending row with a fresh proxyId and replaces
 *     the site's previous subpath row in one batch (one per site)
 *   - getActiveSubpathByProxyId only resolves active rows on active sites
 *   - rotateProxyId / deleteSubpathForSite / setSubpathStatus scope to subpath rows
 *   - getPrimaryPublicLocation precedence: active subpath > custom > default
 *
 * IDs are file-scoped ("sub-*") so this suite never collides with the other
 * suites sharing the miniflare D1 instance.
 *
 * Run via:
 *   pnpm --filter @vc/db test
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createD1DomainRepository, createDataAccess } from "@vc/db";
import { ConflictError } from "@vc/core";

const WORKSPACE_ID = "ws-sub";
const T = 1_700_000_000;

async function insertDomain(fields: {
  id: string;
  siteId: string;
  hostname: string;
  type: string;
  status: string;
  basePath?: string;
  proxyId?: string;
  createdAt?: number;
}) {
  await env.DB.prepare(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      fields.id,
      fields.siteId,
      fields.hostname,
      fields.type,
      fields.status,
      fields.basePath ?? null,
      fields.proxyId ?? null,
      fields.createdAt ?? T,
      T,
    )
    .run();
}

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(WORKSPACE_ID, "Sub Workspace", WORKSPACE_ID, T, T)
    .run();

  for (const id of [
    "site-sub-a", // insert + replace + status + rotate + delete
    "site-sub-b", // hostname conflict holder
    "site-sub-archived", // inactive-site filter
    "site-sub-primary", // primary-location precedence
    "site-sub-multi", // multiple active custom domains
    "site-sub-none", // no domains at all
  ]) {
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, WORKSPACE_ID, id, id, T, T)
      .run();
  }
  await env.DB.prepare("UPDATE sites SET status = 'archived' WHERE id = ?").bind("site-sub-archived").run();

  // Another site owns this hostname as a custom domain; a subpath insert must
  // not be able to take it over.
  await insertDomain({
    id: "dom-sub-b",
    siteId: "site-sub-b",
    hostname: "taken.example.test",
    type: "custom",
    status: "active",
  });
});

describe("insertSubpath", () => {
  it("creates a pending subpath row with basePath and a random proxyId", async () => {
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "a.example.test",
      basePath: "/blog",
    });
    expect(record.type).toBe("subpath");
    expect(record.status).toBe("pending");
    expect(record.basePath).toBe("/blog");
    expect(record.proxyId).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const row = await repo.getByHostname("a.example.test");
    expect(row).toMatchObject({ type: "subpath", siteId: "site-sub-a", proxyId: record.proxyId });
  });

  it("replaces the site's existing subpath row in one batch", async () => {
    const repo = createD1DomainRepository(env.DB);
    const first = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "a2.example.test",
      basePath: "/notes",
    });
    const second = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "a3.example.test",
      basePath: "/blog",
    });
    expect(second.proxyId).not.toBe(first.proxyId);

    const subpaths = (await repo.listBySite("site-sub-a")).filter((row) => row.type === "subpath");
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0]).toMatchObject({ hostname: "a3.example.test", basePath: "/blog", proxyId: second.proxyId });
    // The replaced row's proxy id is gone entirely.
    expect(await repo.getActiveSubpathByProxyId(first.proxyId!)).toBeNull();
  });

  it("rejects a hostname already connected to another site", async () => {
    const repo = createD1DomainRepository(env.DB);
    await expect(
      repo.insertSubpath({ siteId: "site-sub-a", hostname: "taken.example.test", basePath: "/blog" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("getActiveSubpathByProxyId", () => {
  it("resolves only active subpath rows on active sites", async () => {
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "active.example.test",
      basePath: "/blog",
    });
    // Pending rows are invisible to the proxy.
    expect(await repo.getActiveSubpathByProxyId(record.proxyId!)).toBeNull();

    await repo.setSubpathStatus(record.id, "site-sub-a", "active");
    const hit = await repo.getActiveSubpathByProxyId(record.proxyId!);
    expect(hit).toEqual({
      id: record.id,
      siteId: "site-sub-a",
      hostname: "active.example.test",
      basePath: "/blog",
      proxyId: record.proxyId,
    });

    // An active row on an archived site is not servable.
    const archived = await repo.insertSubpath({
      siteId: "site-sub-archived",
      hostname: "archived.example.test",
      basePath: "/blog",
    });
    await repo.setSubpathStatus(archived.id, "site-sub-archived", "active");
    expect(await repo.getActiveSubpathByProxyId(archived.proxyId!)).toBeNull();
  });
});

describe("rotateProxyId, deleteSubpathForSite, setSubpathStatus", () => {
  it("rotates the proxy id without touching hostname or basePath", async () => {
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "rotate.example.test",
      basePath: "/blog",
    });
    const rotated = await repo.rotateProxyId(record.id, "site-sub-a");
    expect(rotated).not.toBe(record.proxyId);
    expect(await repo.getByHostname("rotate.example.test")).toMatchObject({ proxyId: rotated });
  });

  it("persists verification status and errors, clearing errors when omitted", async () => {
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "status.example.test",
      basePath: "/blog",
    });
    await repo.setSubpathStatus(record.id, "site-sub-a", "failed", JSON.stringify(["no response"]));
    expect(await repo.getByHostname("status.example.test")).toMatchObject({
      status: "failed",
      verificationErrorsJson: '["no response"]',
    });
    await repo.setSubpathStatus(record.id, "site-sub-a", "active");
    expect(await repo.getByHostname("status.example.test")).toMatchObject({
      status: "active",
      verificationErrorsJson: null,
    });
  });

  it("deletes only the site's subpath row", async () => {
    const repo = createD1DomainRepository(env.DB);
    await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "delete.example.test",
      basePath: "/blog",
    });
    expect(await repo.deleteSubpathForSite("site-sub-a")).toBeGreaterThanOrEqual(1);
    expect(await repo.getByHostname("delete.example.test")).toBeNull();
    // Idempotent: nothing left for the site.
    expect(await repo.deleteSubpathForSite("site-sub-a")).toBe(0);
    // Other sites' rows are untouched.
    expect(await repo.getByHostname("taken.example.test")).not.toBeNull();
  });
});

describe("getPrimaryPublicLocation", () => {
  it("prefers active subpath over custom over default, and ignores pending", async () => {
    const repo = createD1DomainRepository(env.DB);
    const siteId = "site-sub-primary";
    await insertDomain({ id: "dom-p-def", siteId, hostname: "p-default.example.test", type: "default", status: "active" });
    expect(await repo.getPrimaryPublicLocation(siteId)).toEqual({
      type: "default",
      hostname: "p-default.example.test",
      basePath: "",
    });

    await insertDomain({ id: "dom-p-cust", siteId, hostname: "p-custom.example.test", type: "custom", status: "active" });
    expect(await repo.getPrimaryPublicLocation(siteId)).toEqual({
      type: "custom",
      hostname: "p-custom.example.test",
      basePath: "",
    });

    // A pending subpath must not win over the active custom row.
    await insertDomain({
      id: "dom-p-sub-pending",
      siteId,
      hostname: "p-pending.example.test",
      type: "subpath",
      status: "pending",
      basePath: "/blog",
      proxyId: "pending-proxy",
    });
    expect((await repo.getPrimaryPublicLocation(siteId))?.type).toBe("custom");

    await insertDomain({
      id: "dom-p-sub",
      siteId,
      hostname: "p-customer.example.test",
      type: "subpath",
      status: "active",
      basePath: "/blog",
      proxyId: "active-proxy",
    });
    expect(await repo.getPrimaryPublicLocation(siteId)).toEqual({
      type: "subpath",
      hostname: "p-customer.example.test",
      basePath: "/blog",
    });
  });

  it("returns null for a site with no active domain", async () => {
    const repo = createD1DomainRepository(env.DB);
    expect(await repo.getPrimaryPublicLocation("site-sub-none")).toBeNull();
  });

  it("picks the oldest active custom domain when several exist", async () => {
    const repo = createD1DomainRepository(env.DB);
    const siteId = "site-sub-multi";
    // Insert the newer row first; without a deterministic ORDER BY the storage
    // order would win and this picks the wrong hostname.
    await insertDomain({
      id: "dom-multi-b-new",
      siteId,
      hostname: "multi-new.example.test",
      type: "custom",
      status: "active",
      createdAt: T + 100,
    });
    await insertDomain({
      id: "dom-multi-a-old",
      siteId,
      hostname: "multi-old.example.test",
      type: "custom",
      status: "active",
      createdAt: T,
    });
    expect(await repo.getPrimaryPublicLocation(siteId)).toEqual({
      type: "custom",
      hostname: "multi-old.example.test",
      basePath: "",
    });
  });
});

describe("read-model subpath lookups (slice B)", () => {
  it("resolveSubpathByProxyId returns only active subpath rows on active sites", async () => {
    const readModel = createDataAccess(env.DB).publicBlog;
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({ siteId: "site-sub-a", hostname: "rm.example.test", basePath: "/blog" });
    await repo.setSubpathStatus(record.id, "site-sub-a", "active");

    expect(await readModel.resolveSubpathByProxyId(record.proxyId!)).toMatchObject({
      siteId: "site-sub-a",
      hostname: "rm.example.test",
      basePath: "/blog",
    });
    expect(await readModel.resolveSubpathByProxyId("missing-proxy-id")).toBeNull();
  });

  it("resolveSiteByHost carries the primary location with subpath precedence", async () => {
    const readModel = createDataAccess(env.DB).publicBlog;
    await insertDomain({
      id: "dom-rm-default",
      siteId: "site-sub-a",
      hostname: "rm-default.example.test",
      type: "default",
      status: "active",
    });
    const site = await readModel.resolveSiteByHost("rm-default.example.test");
    // site-sub-a's subpath (activated above) wins over the default host.
    expect(site?.primaryLocation).toMatchObject({ type: "subpath", hostname: "rm.example.test", basePath: "/blog" });
    expect(await readModel.resolveSiteByHost("rm.example.test")).toBeNull();
  });
});
