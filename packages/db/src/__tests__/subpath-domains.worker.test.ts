/**
 * Subpath-domain repository contracts under real miniflare D1 (plans/022 slice A).
 *
 * Covers the `subpath` row lifecycle the proxy ingress depends on:
 *   - insertSubpath creates a pending row with a fresh proxyId and replaces
 *     the site's previous subpath row in one batch (one per site)
 *   - getSubpathByProxyId resolves rows of any status on active sites (the
 *     ingress gates serving on status); listActiveSubpaths feeds the cron
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
  activatedAt?: number | null;
  verificationErrorsJson?: string;
  createdAt?: number;
  updatedAt?: number;
}) {
  await env.DB.prepare(
    "INSERT INTO domains (id, site_id, hostname, type, status, base_path, proxy_id, activated_at, verification_errors_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      fields.id,
      fields.siteId,
      fields.hostname,
      fields.type,
      fields.status,
      fields.basePath ?? null,
      fields.proxyId ?? null,
      fields.activatedAt ?? null,
      fields.verificationErrorsJson ?? null,
      fields.createdAt ?? T,
      fields.updatedAt ?? T,
    )
    .run();
}

async function insertSite(siteId: string, status = "active") {
  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(siteId, WORKSPACE_ID, siteId, siteId, status, T, T)
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

  // Another site owns this hostname as a custom domain; a pending subpath
  // claim may coexist with it now (0036) — the custom row keeps exclusive
  // ownership of the hostname itself.
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
    expect(await repo.getSubpathByProxyId(first.proxyId!)).toBeNull();
  });

  it("lets pending claims for the same hostname coexist across sites and alongside custom rows", async () => {
    const repo = createD1DomainRepository(env.DB);
    // The hostname is already claimed by a custom row (site-b): a subpath
    // claim is scoped to a base path and must NOT be rejected.
    const onCustom = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "taken.example.test",
      basePath: "/blog",
    });
    expect(onCustom.status).toBe("pending");

    // Two sites can each hold a pending claim on the same hostname — only a
    // verified location owns it.
    await repo.insertSubpath({ siteId: "site-sub-a", hostname: "shared.example.test", basePath: "/blog" });
    const claimB = await repo.insertSubpath({ siteId: "site-sub-b", hostname: "shared.example.test", basePath: "/news" });
    const rows = (await repo.listBySite("site-sub-b")).filter((row) => row.hostname === "shared.example.test");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "subpath", status: "pending", basePath: "/news" });
    expect(claimB.proxyId).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("getSubpathByProxyId", () => {
  it("resolves subpath rows of any status on active sites", async () => {
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "active.example.test",
      basePath: "/blog",
    });
    // Pending rows resolve too: the ingress needs them for `/_vc/health` and
    // the "not connected" page state — serving is gated on `status` upstream.
    expect(await repo.getSubpathByProxyId(record.proxyId!)).toMatchObject({
      siteId: "site-sub-a",
      status: "pending",
    });

    await repo.setSubpathStatus(record.id, "site-sub-a", "active");
    const hit = await repo.getSubpathByProxyId(record.proxyId!);
    expect(hit).toEqual({
      id: record.id,
      siteId: "site-sub-a",
      hostname: "active.example.test",
      basePath: "/blog",
      proxyId: record.proxyId,
      status: "active",
    });

    // An active row on an archived site is not servable.
    const archived = await repo.insertSubpath({
      siteId: "site-sub-archived",
      hostname: "archived.example.test",
      basePath: "/blog",
    });
    await repo.setSubpathStatus(archived.id, "site-sub-archived", "active");
    expect(await repo.getSubpathByProxyId(archived.proxyId!)).toBeNull();
  });
});

describe("listActiveSubpaths", () => {
  it("returns only active subpath rows on active sites, capped", async () => {
    const repo = createD1DomainRepository(env.DB);
    const rows = await repo.listActiveSubpaths(200);
    // Suites share the D1 instance: assert invariants, not exact membership —
    // every row is active on an active site, and ours is among them.
    expect(rows.every((row) => row.status === "active")).toBe(true);
    expect(rows.some((row) => row.siteId === "site-sub-a" && row.hostname === "active.example.test")).toBe(true);
    expect(rows.some((row) => row.siteId === "site-sub-archived")).toBe(false);
    expect((await repo.listActiveSubpaths(1)).length).toBeLessThanOrEqual(1);
  });
});

describe("listActiveSubpaths ordering", () => {
  it("serves least-recently-checked rows first so skipped rows lead the next sweep", async () => {
    const repo = createD1DomainRepository(env.DB);
    await insertSite("site-sub-recheck");
    await insertDomain({
      id: "dom-recheck-old",
      siteId: "site-sub-recheck",
      hostname: "recheck-old.example.test",
      type: "subpath",
      status: "active",
      basePath: "/blog",
      proxyId: "recheck-old-proxy-0000001",
      verificationErrorsJson: JSON.stringify({ ok: true, errors: [], warnings: [], checkedAt: 100 }),
    });
    await insertDomain({
      id: "dom-recheck-new",
      siteId: "site-sub-recheck",
      hostname: "recheck-new.example.test",
      type: "subpath",
      status: "active",
      basePath: "/blog",
      proxyId: "recheck-new-proxy-0000001",
      verificationErrorsJson: JSON.stringify({ ok: true, errors: [], warnings: [], checkedAt: 200 }),
    });
    await insertDomain({
      id: "dom-recheck-never",
      siteId: "site-sub-recheck",
      hostname: "recheck-never.example.test",
      type: "subpath",
      status: "active",
      basePath: "/blog",
      proxyId: "recheck-never-proxy-00001",
    });

    const mine = (await repo.listActiveSubpaths(200)).map((row) => row.id).filter((id) => id.startsWith("dom-recheck-"));
    // Never-checked first, then oldest checkedAt, then newer.
    expect(mine).toEqual(["dom-recheck-never", "dom-recheck-old", "dom-recheck-new"]);
  });
});

describe("recordSubpathCheck", () => {
  it("applies only while the row still carries the checked proxy id", async () => {
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "conditional.example.test",
      basePath: "/blog",
    });
    const resultJson = JSON.stringify({ ok: true, errors: [], warnings: [], checkedAt: T });

    // A check that finished after the link rotated changes nothing.
    await repo.rotateProxyId(record.id, "site-sub-a");
    const stale = await repo.recordSubpathCheck(record.id, "site-sub-a", {
      proxyId: record.proxyId!,
      checkPassed: true,
      verificationErrorsJson: resultJson,
    });
    expect(stale).toEqual({ applied: 0, demoted: [] });
    expect(await repo.getByHostname("conditional.example.test")).toMatchObject({ status: "pending" });

    // Against the current proxy id the result lands and activates the row.
    const rotated = (await repo.getByHostname("conditional.example.test"))!.proxyId!;
    const applied = await repo.recordSubpathCheck(record.id, "site-sub-a", {
      proxyId: rotated,
      checkPassed: true,
      verificationErrorsJson: resultJson,
    });
    expect(applied.applied).toBe(1);
    expect(applied.demoted).toEqual([]);
    expect(await repo.getByHostname("conditional.example.test")).toMatchObject({
      status: "active",
      verificationErrorsJson: resultJson,
    });
    // The first activation is stamped so stale-claim pruning never eats a
    // once-live row.
    expect((await repo.getByHostname("conditional.example.test"))!.activatedAt).not.toBeNull();
  });

  it("a failed check never demotes an active row (status logic lives in SQL)", async () => {
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "nodemote.example.test",
      basePath: "/blog",
    });
    await repo.setSubpathStatus(record.id, "site-sub-a", "active");

    const failJson = JSON.stringify({ ok: false, errors: [{ code: "no_response", message: "down" }], warnings: [], checkedAt: T });
    const applied = await repo.recordSubpathCheck(record.id, "site-sub-a", {
      proxyId: record.proxyId!,
      checkPassed: false,
      verificationErrorsJson: failJson,
    });
    expect(applied.applied).toBe(1);
    expect(applied.demoted).toEqual([]);
    expect(await repo.getByHostname("nodemote.example.test")).toMatchObject({
      status: "active",
      verificationErrorsJson: failJson,
    });

    // Pending rows DO flip to failed.
    const pending = await repo.insertSubpath({
      siteId: "site-sub-a",
      hostname: "willfail.example.test",
      basePath: "/blog",
    });
    const applied2 = await repo.recordSubpathCheck(pending.id, "site-sub-a", {
      proxyId: pending.proxyId!,
      checkPassed: false,
      verificationErrorsJson: failJson,
    });
    expect(applied2.applied).toBe(1);
    expect(await repo.getByHostname("willfail.example.test")).toMatchObject({ status: "failed" });
  });

  it("a passing check demotes other sites' active rows on the hostname in the same batch", async () => {
    const repo = createD1DomainRepository(env.DB);
    // site-b serves move.example.test/blog today.
    const live = await repo.insertSubpath({ siteId: "site-sub-b", hostname: "move.example.test", basePath: "/blog" });
    await repo.setSubpathStatus(live.id, "site-sub-b", "active");
    // site-a re-points the mount at itself and its check passes.
    const claim = await repo.insertSubpath({ siteId: "site-sub-a", hostname: "move.example.test", basePath: "/blog" });

    const passJson = JSON.stringify({ ok: true, errors: [], warnings: [], checkedAt: T });
    const result = await repo.recordSubpathCheck(claim.id, "site-sub-a", {
      proxyId: claim.proxyId!,
      checkPassed: true,
      verificationErrorsJson: passJson,
    });
    expect(result.applied).toBe(1);
    expect(result.demoted).toHaveLength(1);
    expect(result.demoted[0]).toMatchObject({ id: live.id, siteId: "site-sub-b", hostname: "move.example.test" });

    const loser = (await repo.listBySite("site-sub-b")).find((row) => row.id === live.id)!;
    expect(loser.status).toBe("failed");
    expect(JSON.parse(loser.verificationErrorsJson!).errors[0].code).toBe("superseded");
    const winner = (await repo.listBySite("site-sub-a")).find((row) => row.id === claim.id)!;
    expect(winner.status).toBe("active");
    expect(winner.activatedAt).not.toBeNull();

    // The partial index enforces one active row per hostname: re-activating
    // the loser directly must violate it.
    await expect(
      env.DB.prepare("UPDATE domains SET status = 'active' WHERE id = ?").bind(live.id).run(),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it("a failed check never demotes another site's live row either", async () => {
    const repo = createD1DomainRepository(env.DB);
    const live = await repo.insertSubpath({ siteId: "site-sub-b", hostname: "safe.example.test", basePath: "/blog" });
    await repo.setSubpathStatus(live.id, "site-sub-b", "active");
    const claim = await repo.insertSubpath({ siteId: "site-sub-a", hostname: "safe.example.test", basePath: "/blog" });

    const failJson = JSON.stringify({ ok: false, errors: [{ code: "no_response", message: "down" }], warnings: [], checkedAt: T });
    const result = await repo.recordSubpathCheck(claim.id, "site-sub-a", {
      proxyId: claim.proxyId!,
      checkPassed: false,
      verificationErrorsJson: failJson,
    });
    expect(result.applied).toBe(1);
    expect(result.demoted).toEqual([]);
    expect((await repo.listBySite("site-sub-b")).find((row) => row.id === live.id)!.status).toBe("active");
  });

  it("only reports demotions its own batch actually applied (raced demotion)", async () => {
    const repo = createD1DomainRepository(env.DB);
    const live = await repo.insertSubpath({ siteId: "site-sub-b", hostname: "raced.example.test", basePath: "/blog" });
    await repo.setSubpathStatus(live.id, "site-sub-b", "active");
    const claim = await repo.insertSubpath({ siteId: "site-sub-a", hostname: "raced.example.test", basePath: "/blog" });

    // Simulate the second of two racing checks for the same claimant: both
    // select site-b's active row, but a rival write flips it to failed in the
    // gap between this batch's demotable SELECT and its execution. The demote
    // statement then changes 0 rows and must not be reported in `demoted`.
    const racedDb = new Proxy(env.DB, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "batch" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (stmts: D1PreparedStatement[]) => {
          await env.DB.prepare("UPDATE domains SET status = 'failed' WHERE id = ?").bind(live.id).run();
          return value.call(target, stmts);
        };
      },
    });
    const raced = await createD1DomainRepository(racedDb).recordSubpathCheck(claim.id, "site-sub-a", {
      proxyId: claim.proxyId!,
      checkPassed: true,
      verificationErrorsJson: JSON.stringify({ ok: true, errors: [], warnings: [], checkedAt: T }),
    });
    expect(raced.applied).toBe(1);
    expect(raced.demoted).toEqual([]);
    expect((await repo.listBySite("site-sub-a")).find((row) => row.id === claim.id)!.status).toBe("active");
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
  it("resolveSubpathByProxyId returns rows of any status on active sites", async () => {
    const readModel = createDataAccess(env.DB).publicBlog;
    const repo = createD1DomainRepository(env.DB);
    const record = await repo.insertSubpath({ siteId: "site-sub-a", hostname: "rm.example.test", basePath: "/blog" });
    await repo.setSubpathStatus(record.id, "site-sub-a", "active");

    expect(await readModel.resolveSubpathByProxyId(record.proxyId!)).toMatchObject({
      siteId: "site-sub-a",
      hostname: "rm.example.test",
      basePath: "/blog",
      status: "active",
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

describe("deleteStaleSubpathClaims", () => {
  it("prunes only old never-active claims, bounded, leaving live and fresh rows", async () => {
    const repo = createD1DomainRepository(env.DB);
    const STALE = T - 31 * 24 * 60 * 60; // older than the 30-day claim TTL
    const cutoff = T - 30 * 24 * 60 * 60;

    await insertSite("site-sub-prune");
    // Prunable: pending + failed, never activated, untouched for a month.
    await insertDomain({ id: "dom-prune-p", siteId: "site-sub-prune", hostname: "prune-p.example.test", type: "subpath", status: "pending", updatedAt: STALE });
    await insertDomain({ id: "dom-prune-f", siteId: "site-sub-prune", hostname: "prune-f.example.test", type: "subpath", status: "failed", updatedAt: STALE });
    // Kept: fresh claim, a once-live row (activated_at set), and a custom row.
    await insertDomain({ id: "dom-prune-fresh", siteId: "site-sub-prune", hostname: "prune-fresh.example.test", type: "subpath", status: "pending", updatedAt: T });
    await insertDomain({ id: "dom-prune-live", siteId: "site-sub-prune", hostname: "prune-live.example.test", type: "subpath", status: "failed", activatedAt: STALE, updatedAt: STALE });
    await insertDomain({ id: "dom-prune-custom", siteId: "site-sub-prune", hostname: "prune-c.example.test", type: "custom", status: "pending", updatedAt: STALE });

    expect(await repo.deleteStaleSubpathClaims(cutoff, 500)).toBe(2);

    const remaining = (await repo.listBySite("site-sub-prune")).map((row) => row.id).sort();
    expect(remaining).toEqual(["dom-prune-custom", "dom-prune-fresh", "dom-prune-live"]);
    // Idempotent: nothing left to prune.
    expect(await repo.deleteStaleSubpathClaims(cutoff, 500)).toBe(0);
  });

  it("honours the per-run limit", async () => {
    const repo = createD1DomainRepository(env.DB);
    const STALE = T - 31 * 24 * 60 * 60;
    const cutoff = T - 30 * 24 * 60 * 60;
    await insertSite("site-sub-prune-cap");
    for (let i = 0; i < 3; i++) {
      await insertDomain({
        id: `dom-prune-cap-${i}`,
        siteId: "site-sub-prune-cap",
        hostname: `prune-cap-${i}.example.test`,
        type: "subpath",
        status: "pending",
        updatedAt: STALE,
      });
    }
    expect(await repo.deleteStaleSubpathClaims(cutoff, 2)).toBe(2);
    expect(await repo.deleteStaleSubpathClaims(cutoff, 2)).toBe(1);
  });
});
