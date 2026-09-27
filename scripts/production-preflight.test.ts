import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { checkLegacyData, checkPricing, productionPolarEnv } from "./production-preflight.ts";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalScheduledAck = process.env.ACK_LEGACY_SCHEDULED_POSTS;
const originalUnversionedAck = process.env.ACK_LEGACY_UNVERSIONED_POSTS;
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  if (originalScheduledAck === undefined) delete process.env.ACK_LEGACY_SCHEDULED_POSTS;
  else process.env.ACK_LEGACY_SCHEDULED_POSTS = originalScheduledAck;
  if (originalUnversionedAck === undefined) delete process.env.ACK_LEGACY_UNVERSIONED_POSTS;
  else process.env.ACK_LEGACY_UNVERSIONED_POSTS = originalUnversionedAck;
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("D1 preflight blocks legacy conversion until current counts are acknowledged", async () => {
  delete process.env.ACK_LEGACY_SCHEDULED_POSTS;
  delete process.env.ACK_LEGACY_UNVERSIONED_POSTS;
  const sql: string[] = [];
  const warnings: string[] = [];
  console.warn = (message) => warnings.push(String(message));
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, "POST");
    const statement = (JSON.parse(String(init?.body)) as { sql: string }).sql;
    assert.match(statement, /^SELECT /);
    sql.push(statement);
    let results: unknown[];
    if (statement.includes("sqlite_master")) results = [{ name: "user" }, { name: "posts" }, { name: "post_versions" }];
    else if (statement.includes("pragma_table_info")) results = [{ name: "id" }, { name: "status" }];
    else if (statement.includes("SELECT lower(trim(email))")) results = [{ email: "owner@example.com", count: 2, ids: "u1,u2" }];
    else if (statement.includes("count(*) AS count FROM (SELECT 1 FROM user")) results = [{ count: 1 }];
    else if (statement.includes("status = 'scheduled'")) results = statement.includes("count(*)") ? [{ count: 2 }] : [{ id: "p1" }, { id: "p2" }];
    else if (statement.includes("status = 'published'")) results = statement.includes("count(*)") ? [{ count: 1 }] : [{ id: "p3" }];
    else throw new Error(`Unexpected SQL ${statement}`);
    return json({ success: true, result: [{ success: true, results }] });
  };
  const failures: string[] = [];
  await checkLegacyData("account", "database", "token", failures);
  assert.match(failures[0]!, /1 collision group.*owner@example.com \[u1,u2\]/);
  assert.match(failures[1]!, /2 scheduled post.*p1, p2.*Recreate legitimate schedules.*ACK_LEGACY_SCHEDULED_POSTS=2/);
  assert.match(failures[2]!, /1 published post.*p3.*Create post_versions snapshots.*ACK_LEGACY_UNVERSIONED_POSTS=1/);
  process.env.ACK_LEGACY_SCHEDULED_POSTS = "1";
  process.env.ACK_LEGACY_UNVERSIONED_POSTS = "1";
  const staleFailures: string[] = [];
  await checkLegacyData("account", "database", "token", staleFailures);
  assert.match(staleFailures[1]!, /ACK_LEGACY_SCHEDULED_POSTS=2/);
  process.env.ACK_LEGACY_SCHEDULED_POSTS = "2";
  const acknowledgedFailures: string[] = [];
  await checkLegacyData("account", "database", "token", acknowledgedFailures);
  assert.equal(acknowledgedFailures.length, 1);
  assert.match(warnings[0]!, /1 published post/);
  assert.match(warnings[1]!, /2 scheduled post/);
  assert.match(warnings[2]!, /1 published post/);
  assert.equal(sql.some((statement) => statement.includes("published_version_id")), false);
});

test("D1 preflight checks a missing published pointer when 0018 is present and fails closed on query errors", async () => {
  const seen: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const statement = (JSON.parse(String(init?.body)) as { sql: string }).sql;
    seen.push(statement);
    if (statement.includes("sqlite_master")) return json({ success: true, result: [{ success: true, results: [{ name: "user" }, { name: "posts" }, { name: "post_versions" }] }] });
    if (statement.includes("pragma_table_info")) return json({ success: true, result: [{ success: true, results: [{ name: "published_version_id" }] }] });
    if (statement.includes("count(*)")) return json({ success: true, result: [{ success: true, results: [{ count: 0 }] }] });
    return json({ success: true, result: [{ success: true, results: [] }] });
  };
  const failures: string[] = [];
  await checkLegacyData("account", "database", "token", failures);
  assert.deepEqual(failures, []);
  assert.ok(seen.some((statement) => statement.includes("OR published_version_id IS NULL")));

  globalThis.fetch = async () => json({ success: false, errors: [{ message: "access denied" }] });
  await checkLegacyData("account", "database", "token", failures);
  assert.match(failures[0]!, /read-only D1 migration checks: access denied/);
});

const env = {
  POLAR_ACCESS_TOKEN: "token",
  POLAR_SERVER: "sandbox",
  POLAR_MONTHLY_PRODUCT_ID: "monthly",
  POLAR_YEARLY_PRODUCT_ID: "yearly",
  POLAR_LAUNCH_DISCOUNT_MONTHLY_ID: "monthly-discount",
  POLAR_LAUNCH_DISCOUNT_YEARLY_ID: "yearly-discount",
};

function mockPolar(overrides: Record<string, Record<string, unknown>> = {}, server = "sandbox"): void {
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert.equal(new URL(String(url)).host, server === "production" ? "api.polar.sh" : "sandbox-api.polar.sh");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token");
    const monthly = path.includes("monthly");
    const product = path.includes("/products/");
    const data = product
      ? {
          id: monthly ? "monthly" : "yearly",
          is_recurring: true,
          is_archived: false,
          recurring_interval: monthly ? "month" : "year",
          recurring_interval_count: 1,
          prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: monthly ? 1500 : 15000, is_archived: false }],
        }
      : {
          id: monthly ? "monthly-discount" : "yearly-discount",
          type: "fixed",
          duration: "forever",
          amounts: { usd: monthly ? 600 : 7100 },
          products: [{ id: monthly ? "monthly" : "yearly" }],
        };
    return json({ ...data, ...overrides[path] });
  };
}

test("Polar pricing accepts list prices and forever discounts yielding launch prices", async () => {
  mockPolar();
  await checkPricing(env);
});

test("Polar pricing fails on wrong interval, amount, duration, and effective launch amount", async () => {
  for (const [path, override, expected] of [
    ["/v1/products/monthly", { recurring_interval: "year" }, /monthly Polar product.*interval/],
    ["/v1/products/monthly", { prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: 900 }] }, /1500 cents/],
    ["/v1/discounts/monthly-discount", { duration: "once" }, /duration forever/],
    ["/v1/discounts/yearly-discount", { amounts: { usd: 7000 } }, /7900 cents after discount/],
  ] as const) {
    mockPolar({ [path]: override });
    await assert.rejects(checkPricing(env), expected);
  }
  mockPolar();
  await assert.rejects(checkPricing({ ...env, POLAR_LAUNCH_DISCOUNT_MONTHLY_ID: "" }), /POLAR_LAUNCH_DISCOUNT_MONTHLY_ID is required/);
});

test("production pricing rejects shell-only discounts while sandbox pricing accepts shell values", async () => {
  mockPolar({}, "production");
  const production = productionPolarEnv('"POLAR_SERVER": "production", "POLAR_MONTHLY_PRODUCT_ID": "monthly", "POLAR_YEARLY_PRODUCT_ID": "yearly"', env.POLAR_ACCESS_TOKEN);
  await assert.rejects(checkPricing(production), /POLAR_LAUNCH_DISCOUNT_MONTHLY_ID is required/);
  mockPolar();
  await checkPricing(env);
});

test("Polar percentage discount rounds the discount before subtracting", async () => {
  mockPolar({ "/v1/discounts/yearly-discount": { type: "percentage", basis_points: 4733, amounts: undefined } });
  await checkPricing(env);
});
