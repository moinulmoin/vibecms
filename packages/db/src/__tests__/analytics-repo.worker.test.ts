/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createDataAccess } from "@vc/db";

const data = createDataAccess(env.DB);
const timestamp = 1_704_000_000;

async function seedSite(suffix: string, billingStatus: "active" | "canceled" = "active") {
  const workspaceId = `ws-analytics-${suffix}`;
  const siteId = `site-analytics-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(workspaceId, `Analytics ${suffix}`, `analytics-${suffix}`, timestamp, timestamp),
    env.DB.prepare(
      "INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, status, theme, theme_mode, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'minimal', 'system', ?, ?)",
    ).bind(siteId, workspaceId, `Analytics ${suffix}`, `analytics-${suffix}`, timestamp, timestamp),
    env.DB.prepare(
      "INSERT OR REPLACE INTO billing_customers (id, workspace_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(`billing-${suffix}`, workspaceId, billingStatus, timestamp, timestamp),
  ]);
  return { workspaceId, siteId };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
});

describe("analytics rollup repository", () => {
  it("replaces a day with absolute aggregates so retries cannot double count", async () => {
    const { siteId } = await seedSite("absolute");
    const values = [
      { kind: "page" as const, dimension: "", label: null, value: 12 },
      { kind: "post" as const, dimension: "post-a", label: "hello", value: 12 },
    ];

    await data.analytics.replaceDaily(siteId, "2026-07-20", values);
    await data.analytics.replaceDaily(siteId, "2026-07-20", values);

    const rows = await data.analytics.listDaily(siteId, "2026-07-20", "2026-07-20");
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.kind === "page")?.value).toBe(12);
    expect(await data.analytics.getLastRolledDate(siteId)).toBe("2026-07-20");
  });

  it("compacts eligible daily rows per site without deleting another site's monthly history", async () => {
    const first = await seedSite("compact-a");
    const second = await seedSite("compact-b");
    await data.analytics.replaceDaily(first.siteId, "2024-01-03", [
      { kind: "page", dimension: "", label: null, value: 4 },
      { kind: "post", dimension: "post-a", label: "a", value: 4 },
    ]);
    await data.analytics.replaceDaily(first.siteId, "2024-01-04", [
      { kind: "page", dimension: "", label: null, value: 6 },
      { kind: "post", dimension: "post-a", label: "a", value: 6 },
    ]);
    await data.analytics.replaceDaily(second.siteId, "2024-01-03", [
      { kind: "page", dimension: "", label: null, value: 9 },
    ]);

    expect(await data.analytics.compactDailyBefore("2025-02-01")).toBe(2);

    expect(await data.analytics.listDaily(first.siteId, "2024-01-01", "2024-01-31")).toEqual([]);
    expect(await data.analytics.listDaily(second.siteId, "2024-01-01", "2024-01-31")).toEqual([]);
    expect((await data.analytics.listMonthly(first.siteId))[0]).toMatchObject({
      periodStart: "2024-01",
      kind: "page",
      value: 10,
    });
    expect((await data.analytics.listMonthly(second.siteId))[0]).toMatchObject({
      periodStart: "2024-01",
      kind: "page",
      value: 9,
    });
  });

  it("stops selecting canceled sites while retaining their historical rows", async () => {
    const { workspaceId, siteId } = await seedSite("cancel");
    await data.analytics.replaceDaily(siteId, "2026-07-20", [
      { kind: "page", dimension: "", label: null, value: 7 },
    ]);
    expect((await data.analytics.listActiveSites()).some((site) => site.id === siteId)).toBe(true);

    await env.DB.prepare("UPDATE billing_customers SET status = 'canceled' WHERE workspace_id = ?")
      .bind(workspaceId)
      .run();

    expect((await data.analytics.listActiveSites()).some((site) => site.id === siteId)).toBe(false);
    expect(await data.analytics.listDaily(siteId, "2026-07-20", "2026-07-20")).toHaveLength(1);
  });
});
