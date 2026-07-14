/**
 * Usage-quota + rate-limit counter repository contracts under real miniflare D1.
 *
 * Phase 3 of the Drizzle migration converted the conditional COUNTER upserts to
 * Drizzle: a usage-quota repo (db.usage) and a generic rate-limits repo
 * (db.rateLimits). Both make allow/deny decisions from the affected-row count
 * (meta.changes) of a GUARDED onConflictDoUpdate({ ..., setWhere }). That guard
 * is the single most regression-prone part of this migration — drop `setWhere`
 * and counters silently exceed their cap while still reporting success. This
 * suite defends exactly those guard semantics, plus the fixed-window invariant
 * (expires_at is stamped once and never refreshed), the strict-less-than delete
 * boundary, and the release clamp.
 *
 * IDs are file-scoped ("ctr-") so this file never collides with the other
 * suites sharing the miniflare D1 instance (isolation: site-a/b/ws-iso; leaf:
 * leaf-*; sb-* for sites+billing).
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
import {
  createDataAccess,
  type IncrementUsageInput,
  type IncrementRateLimitInput,
} from "@vc/db";

// Workspace FK target for usage_counters.workspace_id. Every counter below uses
// this workspace; counters are disambiguated by a unique `metric` per id so the
// (workspace_id, site_id, period, metric) unique index never collides.
const WS = "ctr-ws";

// Fixed epoch-second anchors. The rate-limits repo takes an explicit now +
// windowExpiresAt, so these make every expires_at assertion deterministic and
// let the window-stability test pass DIFFERENT window values to prove the
// stored one never moves. T_OLD < T_A (now) < T_FUTURE.
const T_OLD = 1_600_000_000;
const T_A = 1_700_000_000;
const T_B = 1_710_000_000; // intentionally != T_A: a refresh would overwrite to this
const T_FUTURE = 1_800_000_000;

// Shared data access over the real miniflare D1 binding.
const da = createDataAccess(env.DB);

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(WS, "Counters Workspace", WS, ts, ts)
    .run();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Build a usage increment input for a counter. `metric` is forced equal to the
// id so the (workspace_id, site_id, period, metric) unique index stays distinct
// across every counter this file creates.
function usageInput(id: string, limit: number): IncrementUsageInput {
  return { id, workspaceId: WS, siteId: null, period: "2024-01", metric: id, limit };
}

// Read a raw rate_limits row by id for direct count/expires_at inspection. Raw
// SQL is fine here: the repo exposes no read path, and we are inspecting, not
// asserting the repo's own behaviour through itself.
async function getRateLimit(
  id: string,
): Promise<{ count: number; expires_at: number } | null> {
  return env.DB.prepare("SELECT count, expires_at FROM rate_limits WHERE id = ?")
    .bind(id)
    .first<{ count: number; expires_at: number }>();
}

// ---------------------------------------------------------------------------
// usage.readCounter — 0 for an absent counter
// ---------------------------------------------------------------------------

describe("usage.readCounter — 0 for an unknown id", () => {
  it("yields 0 (not null/undefined) when no row exists", async () => {
    expect(await da.usage.readCounter("ctr-absent")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// usage.incrementCounter — guarded upsert
// ---------------------------------------------------------------------------

describe("usage.incrementCounter — applies while under the limit", () => {
  it("reports applied=true and readCounter climbs 0 -> 1 -> 2", async () => {
    const id = "ctr-usage-grow";
    expect(await da.usage.readCounter(id)).toBe(0);

    const first = await da.usage.incrementCounter(usageInput(id, 3));
    expect(first.applied).toBe(true);
    expect(await da.usage.readCounter(id)).toBe(1);

    const second = await da.usage.incrementCounter(usageInput(id, 3));
    expect(second.applied).toBe(true);
    expect(await da.usage.readCounter(id)).toBe(2);
  });
});

describe("usage.incrementCounter — rejects at the limit (setWhere guard)", () => {
  it("returns applied=false past the cap and leaves the value unchanged", async () => {
    const id = "ctr-usage-cap";
    const limit = 2;

    // Climb to exactly the limit. The guard is `value + excluded.value <= limit`
    // (excluded.value is always 1), so value == limit is the last allowed step.
    expect((await da.usage.incrementCounter(usageInput(id, limit))).applied).toBe(true);
    expect(await da.usage.readCounter(id)).toBe(1);
    expect((await da.usage.incrementCounter(usageInput(id, limit))).applied).toBe(true);
    expect(await da.usage.readCounter(id)).toBe(limit);

    // THE guard: the next increment must be rejected — value+1 would exceed limit.
    const over = await da.usage.incrementCounter(usageInput(id, limit));
    expect(over.applied).toBe(false);
    // Value must NOT increase past the limit.
    expect(await da.usage.readCounter(id)).toBe(limit);

    // A second over-limit attempt still changes nothing.
    expect((await da.usage.incrementCounter(usageInput(id, limit))).applied).toBe(false);
    expect(await da.usage.readCounter(id)).toBe(limit);
  });
});

// ---------------------------------------------------------------------------
// usage.releaseCounter — decrement clamped at 0
// ---------------------------------------------------------------------------

describe("usage.releaseCounter — clamps at 0, never negative", () => {
  it("decrements toward 0 then floors despite extra releases", async () => {
    const id = "ctr-release";
    await da.usage.incrementCounter(usageInput(id, 5));
    await da.usage.incrementCounter(usageInput(id, 5));
    expect(await da.usage.readCounter(id)).toBe(2);

    await da.usage.releaseCounter(id);
    expect(await da.usage.readCounter(id)).toBe(1);

    await da.usage.releaseCounter(id);
    expect(await da.usage.readCounter(id)).toBe(0);

    // More releases than increments: must floor at 0, never go negative.
    await da.usage.releaseCounter(id);
    await da.usage.releaseCounter(id);
    expect(await da.usage.readCounter(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rateLimits.increment — capped fixed-window counter
// ---------------------------------------------------------------------------

describe("rateLimits.increment — allows hits 1..max then denies at the cap", () => {
  it("allowed=true up to max and allowed=false once count would exceed max", async () => {
    const id = "ctr-rl-cap";
    const max = 3;
    const input: IncrementRateLimitInput = { id, windowExpiresAt: T_A, max, now: T_A };

    const allowed: boolean[] = [];
    for (let i = 0; i < max; i++) {
      allowed.push((await da.rateLimits.increment(input)).allowed);
    }
    expect(allowed).toStrictEqual([true, true, true]);

    // Raw count at the cap equals max.
    expect((await getRateLimit(id))?.count).toBe(max);

    // One more hit must be denied: the guard `count < max` is false at count==max.
    const denied = await da.rateLimits.increment(input);
    expect(denied.allowed).toBe(false);
    // Count stays pinned at max — no over-increment leaked through.
    expect((await getRateLimit(id))?.count).toBe(max);
  });
});

describe("rateLimits.increment — expires_at is fixed once stamped", () => {
  it("keeps the first-insert expires_at across a later hit (fixed window)", async () => {
    const id = "ctr-rl-window";
    const max = 5;

    // First hit stamps expires_at = T_A.
    await da.rateLimits.increment({ id, windowExpiresAt: T_A, max, now: T_A });
    expect((await getRateLimit(id))?.expires_at).toBe(T_A);

    // Second hit passes a DIFFERENT window value. A refresh would overwrite to
    // T_B; the fixed-window contract must leave the stored expires_at at T_A.
    await da.rateLimits.increment({ id, windowExpiresAt: T_B, max, now: T_B });
    const row = await getRateLimit(id);
    expect(row?.count).toBe(2);
    expect(row?.expires_at).toBe(T_A);
  });
});

// ---------------------------------------------------------------------------
// rateLimits.deleteExpired — strict-less-than scoping
// ---------------------------------------------------------------------------

describe("rateLimits.deleteExpired — removes expired rows, keeps valid ones", () => {
  it("deletes rows with expires_at < now and leaves expires_at >= now", async () => {
    const expiredId = "ctr-rl-exp-a"; // expires_at < now  -> deleted
    const boundaryId = "ctr-rl-exp-eq"; // expires_at == now -> KEPT (strict <)
    const validId = "ctr-rl-exp-b"; // expires_at > now  -> kept

    await da.rateLimits.increment({ id: expiredId, windowExpiresAt: T_OLD, max: 5, now: T_OLD });
    await da.rateLimits.increment({ id: boundaryId, windowExpiresAt: T_A, max: 5, now: T_A });
    await da.rateLimits.increment({ id: validId, windowExpiresAt: T_FUTURE, max: 5, now: T_FUTURE });
    expect(await getRateLimit(expiredId)).not.toBeNull();
    expect(await getRateLimit(boundaryId)).not.toBeNull();
    expect(await getRateLimit(validId)).not.toBeNull();

    await da.rateLimits.deleteExpired(T_A);

    expect(await getRateLimit(expiredId)).toBeNull(); // expires_at < now
    expect(await getRateLimit(boundaryId)).not.toBeNull(); // == now is NOT expired
    expect(await getRateLimit(validId)).not.toBeNull(); // expires_at > now
  });
});
