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

  it("accepts the 0034 agent kinds and keeps legacy crawler rows", async () => {
    const { siteId } = await seedSite("agent-kinds");
    await data.analytics.replaceDaily(siteId, "2026-10-10", [
      { kind: "agent" as const, dimension: "GPTBot", label: "GPTBot", value: 5 },
      { kind: "agent_category" as const, dimension: "ai-training", label: null, value: 5 },
      { kind: "agent_post" as const, dimension: "post-a", label: null, value: 3 },
      { kind: "agent_resource" as const, dimension: "repr_markdown", label: null, value: 2 },
      { kind: "crawler" as const, dimension: "ClaudeBot", label: "Anthropic", value: 7 },
    ]);

    const rows = await data.analytics.listDaily(siteId, "2026-10-10", "2026-10-10");
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "agent", "agent_category", "agent_post", "agent_resource", "crawler",
    ]);
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
    const selected = async (now: number) =>
      (await data.managedSites.listEffectiveEntitledActiveSites({ selfHosted: false, now }))
        .some((site) => site.id === siteId);
    await data.analytics.replaceDaily(siteId, "2026-07-20", [
      { kind: "page", dimension: "", label: null, value: 7 },
    ]);
    expect(await selected(timestamp)).toBe(true);

    await env.DB.prepare("UPDATE billing_customers SET status = 'canceled' WHERE workspace_id = ?")
      .bind(workspaceId)
      .run();

    expect(await selected(timestamp)).toBe(false);
    expect(await data.analytics.listDaily(siteId, "2026-07-20", "2026-07-20")).toHaveLength(1);
  });

  it("keeps rolling up a past_due site until its exact grace deadline", async () => {
    const { workspaceId, siteId } = await seedSite("grace");
    const since = 1_900_000_000_123;
    const deadline = since + 7 * 24 * 60 * 60 * 1000;
    const selected = async (nowMs: number) =>
      (await data.managedSites.listEffectiveEntitledActiveSites({ selfHosted: false, now: nowMs / 1000 }))
        .some((site) => site.id === siteId);
    await env.DB.prepare("UPDATE billing_customers SET status = 'past_due', past_due_since = ? WHERE workspace_id = ?")
      .bind(since, workspaceId)
      .run();

    expect(await selected(since)).toBe(true);
    expect(await selected(deadline - 1)).toBe(true);
    expect(await selected(deadline)).toBe(false);
    expect(await selected(deadline + 1)).toBe(false);

    // Unknown start: no grace at all.
    await env.DB.prepare("UPDATE billing_customers SET past_due_since = NULL WHERE workspace_id = ?")
      .bind(workspaceId)
      .run();
    expect(await selected(since)).toBe(false);
  });
});
