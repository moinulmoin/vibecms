import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LAUNCH_OFFER, PRICING } from "../packages/config/src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
let accountId: string;
let apiToken: string;
let productionApiConfig: string;
let productionPublicConfig: string;

async function main(): Promise<void> {
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  return;
}

const apiConfigPath = join(root, "apps/api/wrangler.jsonc");
const publicConfigPath = join(root, "apps/public/wrangler.jsonc");
const apiConfig = readFileSync(apiConfigPath, "utf8");
const publicConfig = readFileSync(publicConfigPath, "utf8");
productionApiConfig = apiConfig.slice(apiConfig.indexOf('"production"'));
productionPublicConfig = publicConfig.slice(publicConfig.indexOf('"production"'));

if (args.includes("--pricing")) {
  await checkPricing(process.env);
  console.log("Polar pricing preflight passed");
  return;
}

accountId = requireEnvironment("CLOUDFLARE_ACCOUNT_ID");
apiToken =
  process.env.CLOUDFLARE_PREFLIGHT_API_TOKEN?.trim()
  || requireEnvironment("CLOUDFLARE_API_TOKEN");

const smokeToken = process.env.PRODUCTION_SMOKE_TOKEN?.trim();
const bootstrapSmoke = process.env.ALLOW_BOOTSTRAP_SMOKE === "1";
const bootstrapSha = process.env.PRODUCTION_BOOTSTRAP_SHA?.trim();
if (!smokeToken && !bootstrapSmoke) {
  throw new Error(
    "PRODUCTION_SMOKE_TOKEN is required for authenticated production smoke. For the first deploy only, set ALLOW_BOOTSTRAP_SMOKE=1 explicitly (authenticated smoke must be run later with PRODUCTION_SMOKE_TOKEN).",
  );
}
if (smokeToken && bootstrapSmoke) {
  console.warn(
    "ALLOW_BOOTSTRAP_SMOKE=1 is ignored because PRODUCTION_SMOKE_TOKEN is set; authenticated smoke will run.",
  );
}
if (!smokeToken && bootstrapSmoke) {
  if (!bootstrapSha || !/^[0-9a-fA-F]{40}$/.test(bootstrapSha)) {
    throw new Error(
      "Bootstrap smoke requires PRODUCTION_BOOTSTRAP_SHA to be the full 40-character SHA reviewed for the first deploy.",
    );
  }
  const currentSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (currentSha.status !== 0) {
    throw new Error(`Unable to verify the bootstrap release SHA: ${currentSha.stderr || currentSha.stdout}`);
  }
  if (currentSha.stdout.trim() !== bootstrapSha.toLowerCase()) {
    throw new Error(
      `PRODUCTION_BOOTSTRAP_SHA=${bootstrapSha} does not match checked-out release ${currentSha.stdout.trim()}.`,
    );
  }
  console.warn(
    "Bootstrap smoke mode enabled for the pinned reviewed SHA: authenticated tenant smoke will be skipped. Remove PRODUCTION_BOOTSTRAP_SHA immediately after this deploy, then create a read token and run PRODUCTION_SMOKE_TOKEN=<token> pnpm production:smoke.",
  );
}

requireConfig(productionApiConfig, '"app.vibecms.dev/*"', "the exact API app-host route");
requireConfig(productionApiConfig, '"CUSTOM_HOSTNAME_CNAME_TARGET": "cname.vibecms.dev"', "the custom-hostname CNAME target");
requireConfig(productionPublicConfig, '"*.vibecms.dev/*"', "the public wildcard route");
requireConfig(productionPublicConfig, '"*/*"', "the Cloudflare for SaaS Worker fallback route");
requireConfig(productionPublicConfig, '"service": "vibecms-prod"', "the public-to-API service binding");
requireConfig(productionApiConfig, '"ANALYTICS_DATASET": "vibecms_page_views_prod"', "the production analytics query dataset");
requireConfig(productionApiConfig, '"CLOUDFLARE_ZONE_ID": "ba566759d1d48dfe268050968fe631af"', "the production zone ID");
requireConfig(productionPublicConfig, '"dataset": "vibecms_page_views_prod"', "the production Analytics Engine binding");
requireConfig(productionApiConfig, '"send_email"', "the production EMAIL send_email binding");
requireConfig(productionPublicConfig, '"IMAGES"', "the production Images binding");
requireConfig(productionApiConfig, '"database_name": "vibecms_prod"', "the production D1 database name");
requireConfig(productionApiConfig, '"bucket_name": "vibecms-assets-prod"', "the production R2 bucket name");

for (const [name, source] of [
  ["API", productionApiConfig],
  ["public", productionPublicConfig],
] as const) {
  if (/REPLACE_ME|00000000-0000-0000-0000-000000000000|placeholder/i.test(source)) {
    throw new Error(`${name} production config still contains a placeholder`);
  }
}

assertNoSessionKvRequired();

const missing: string[] = [];

const d1Id = extractString(productionApiConfig, "database_id");
const d1Name = "vibecms_prod";
const r2Name = "vibecms-assets-prod";
const zoneId = "ba566759d1d48dfe268050968fe631af";
const analyticsDataset = "vibecms_page_views_prod";

await assertD1Exists(d1Name, d1Id, missing);
await checkLegacyData(accountId, d1Id, apiToken, missing);
await assertR2Exists(r2Name, missing);
await assertAnalyticsDatasetConfigured(analyticsDataset, missing);
await assertImagesBindingConfigured(missing);
await assertEmailSendingConfigured(missing);
await assertCustomHostnameFallback(zoneId, missing);
await assertSecrets(missing);
const polarVars = extractPolarVars(productionApiConfig);
if (polarVars.POLAR_SERVER !== "production") {
  missing.push(`Production Worker POLAR_SERVER must be production; got ${polarVars.POLAR_SERVER ?? "missing"}`);
}
try {
  await checkPricing({
    ...process.env,
    ...polarVars,
    POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
  });
} catch (error) {
  missing.push(`Polar pricing: ${error instanceof Error ? error.message : String(error)}`);
}

if (missing.length > 0) {
  throw new Error(`Production preflight found blocking issues:\n- ${missing.join("\n- ")}`);
}

runGate("typecheck", ["pnpm", "typecheck"]);
runGate("lint", ["pnpm", "lint"]);
runGate("test", ["pnpm", "test"]);
runGate("public:audit", ["pnpm", "public:audit"]);
runGate("openapi:check", ["pnpm", "openapi:check"]);

console.log("Building production artifacts before any D1 mutation...");
runGate("dashboard build", ["pnpm", "--filter", "@vc/dashboard", "build"]);
runGate("API production dry-run build", [
  "pnpm",
  "--filter",
  "@vc/api",
  "exec",
  "wrangler",
  "deploy",
  "--dry-run",
  "--env",
  "production",
  "--outdir=dist",
]);
runGate("OG production build", ["pnpm", "--filter", "@vc/og", "exec", "wrangler", "deploy", "--dry-run", "--env", "production", "--outdir", "../../.wrangler/production-og"]);
runGate("public production build", ["pnpm", "--filter", "@vc/public", "build"], {
  CLOUDFLARE_ENV: "production",
});

const markerDir = join(root, ".wrangler/production");
mkdirSync(markerDir, { recursive: true });
writeFileSync(
  join(markerDir, "preflight.json"),
  `${JSON.stringify(
    {
      completedAt: new Date().toISOString(),
      smokeMode: smokeToken ? "authenticated" : "bootstrap",
      resources: {
        d1: { name: d1Name, id: d1Id },
        r2: { name: r2Name },
        analyticsDataset,
        zoneId,
        imagesBinding: "IMAGES",
        emailBinding: "EMAIL",
        sessionKv: "disabled-unused-astro-sessions",
      },
    },
    null,
    2,
  )}\n`,
);

console.log("Production preflight passed (gates + resources/secrets + production artifacts built)");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}

function printHelp(): void {
  console.log(`production:preflight — production gates, resource/secret checks, and artifact builds

Usage:
  pnpm production:preflight
  pnpm preflight:pricing
  pnpm production:preflight -- --help

Runs before any D1 mutation:
  - typecheck, lint, tests, public:audit, openapi:check
  - validates D1/R2/Images/Analytics/Email/custom-hostname resources and required secret names
  - checks legacy D1 rows affected by pending migrations and Polar checkout pricing
  - builds dashboard, API production dry-run, and public production artifacts

Required environment:
  CLOUDFLARE_PREFLIGHT_API_TOKEN or CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  PRODUCTION_SMOKE_TOKEN   (authenticated mode)
  or ALLOW_BOOTSTRAP_SMOKE=1 plus PRODUCTION_BOOTSTRAP_SHA=<full reviewed HEAD SHA>
     (first deploy only; remove the SHA immediately and run authenticated smoke)

Notes:
  - Failures stop before migrations.
  - Astro sessions are disabled; no SESSION KV is required.
  - preflight:pricing requires POLAR_ACCESS_TOKEN, POLAR_SERVER, both POLAR_*_PRODUCT_ID
    and both POLAR_LAUNCH_DISCOUNT_*_ID values in the environment.
`);
}

function extractPolarVars(source: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of [
    "POLAR_SERVER",
    "POLAR_MONTHLY_PRODUCT_ID",
    "POLAR_YEARLY_PRODUCT_ID",
    "POLAR_LAUNCH_DISCOUNT_MONTHLY_ID",
    "POLAR_LAUNCH_DISCOUNT_YEARLY_ID",
  ]) {
    const match = source.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
    if (match?.[1]) vars[name] = match[1];
  }
  return vars;
}

type D1Row = Record<string, unknown>;

function d1Count(rows: D1Row[]): number {
  const count = rows[0]?.count;
  if (!Number.isInteger(count) || (count as number) < 0) {
    throw new Error(`D1 count query returned an invalid count: ${String(count)}`);
  }
  return count as number;
}

export async function checkLegacyData(
  account: string,
  database: string,
  token: string,
  failures: string[],
): Promise<void> {
  async function query(sql: string): Promise<D1Row[]> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = await response.json() as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result?: Array<{ results?: D1Row[]; success?: boolean; error?: string }>;
    };
    if (!response.ok || !body.success || body.result?.[0]?.success === false || !body.result?.[0]?.results) {
      throw new Error(body.errors?.map((error) => error.message).join(", ")
        || body.result?.[0]?.error || `HTTP ${response.status}`);
    }
    return body.result[0].results;
  }

  try {
    const tables = new Set((await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'posts', 'post_versions')"))
      .map((row) => String(row.name)));
    for (const table of ["user", "posts", "post_versions"]) {
      if (!tables.has(table)) throw new Error(`Expected pre-migration table ${table} is missing`);
    }
    const postColumns = new Set((await query("SELECT name FROM pragma_table_info('posts')"))
      .map((row) => String(row.name)));

    const collisions = await query(
      "SELECT lower(trim(email)) AS email, count(*) AS count, group_concat(id) AS ids FROM user GROUP BY lower(trim(email)) HAVING count(*) > 1 ORDER BY email LIMIT 5",
    );
    const collisionCount = d1Count(await query(
      "SELECT count(*) AS count FROM (SELECT 1 FROM user GROUP BY lower(trim(email)) HAVING count(*) > 1)",
    ));
    if (collisionCount) {
      failures.push(`0021 email canonicalization would fail: ${collisionCount} collision group(s); examples ${collisions.map((row) => `${row.email} [${row.ids}]`).join("; ")}. Resolve duplicate accounts/emails explicitly before migration.`);
    }

    const scheduled = await query("SELECT id FROM posts WHERE status = 'scheduled' LIMIT 5");
    const scheduledCount = d1Count(await query("SELECT count(*) AS count FROM posts WHERE status = 'scheduled'"));
    if (scheduledCount) {
      console.warn(`0021 will convert ${scheduledCount} scheduled post(s) to drafts; example ids: ${scheduled.map((row) => row.id).join(", ")}. Recreate legitimate schedules in post_schedules after 0030, with the intended publish time and version, before reopening publishing.`);
    }

    const missingVersion = `status = 'published' AND (NOT EXISTS (SELECT 1 FROM post_versions WHERE post_versions.post_id = posts.id)${postColumns.has("published_version_id") ? " OR published_version_id IS NULL" : ""})`;
    const unversioned = await query(`SELECT id FROM posts WHERE ${missingVersion} LIMIT 5`);
    const unversionedCount = d1Count(await query(`SELECT count(*) AS count FROM posts WHERE ${missingVersion}`));
    if (unversionedCount) {
      console.warn(`0021 may convert ${unversionedCount} published post(s) to drafts or leave them without a live version; example ids: ${unversioned.map((row) => row.id).join(", ")}. Create post_versions snapshots and set published_version_id for these posts before applying 0021; verify their public content afterward.`);
    }
  } catch (error) {
    failures.push(`Unable to run read-only D1 migration checks: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type PolarEnv = Record<string, string | undefined>;
type PolarPrice = { amount_type?: string; price_currency?: string; price_amount?: number; is_archived?: boolean };
type PolarProduct = {
  id?: string; is_recurring?: boolean; is_archived?: boolean;
  recurring_interval?: string; recurring_interval_count?: number | null; prices?: PolarPrice[];
};
type PolarDiscount = {
  id?: string; type?: string; duration?: string; amount?: number; currency?: string;
  amounts?: Record<string, number>; basis_points?: number; products?: Array<{ id?: string }>;
  starts_at?: string | null; ends_at?: string | null;
  max_redemptions?: number | null; redemptions_count?: number;
};

export async function checkPricing(env: PolarEnv): Promise<void> {
  const token = env.POLAR_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("Polar pricing preflight requires POLAR_ACCESS_TOKEN");
  const server = env.POLAR_SERVER?.trim();
  if (server !== "sandbox" && server !== "production") {
    throw new Error("Polar pricing preflight requires POLAR_SERVER=sandbox or production");
  }
  const base = server === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
  async function get<T>(path: string): Promise<T> {
    const response = await fetch(`${base}/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Polar ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    return await response.json() as T;
  }

  for (const plan of [
    { label: "monthly", interval: "month", list: PRICING.monthlyUsd * 100, launch: LAUNCH_OFFER.monthlyUsd * 100, productKey: "POLAR_MONTHLY_PRODUCT_ID", discountKey: "POLAR_LAUNCH_DISCOUNT_MONTHLY_ID" },
    { label: "yearly", interval: "year", list: PRICING.annualUsd * 100, launch: LAUNCH_OFFER.annualUsd * 100, productKey: "POLAR_YEARLY_PRODUCT_ID", discountKey: "POLAR_LAUNCH_DISCOUNT_YEARLY_ID" },
  ]) {
    const productId = env[plan.productKey]?.trim();
    const discountId = env[plan.discountKey]?.trim();
    if (!productId) throw new Error(`${plan.productKey} is required to verify the ${plan.label} checkout`);
    const product = await get<PolarProduct>(`products/${encodeURIComponent(productId)}`);
    if (product.id !== productId || !product.is_recurring || product.is_archived
      || product.recurring_interval !== plan.interval || product.recurring_interval_count !== 1) {
      throw new Error(`${plan.label} Polar product ${productId}: expected active recurring ${plan.interval} interval count 1; got ${JSON.stringify({ interval: product.recurring_interval, count: product.recurring_interval_count, archived: product.is_archived })}`);
    }
    const prices = product.prices?.filter((price) => !price.is_archived) ?? [];
    if (prices.length !== 1 || prices[0]?.amount_type !== "fixed"
      || prices[0].price_currency?.toLowerCase() !== "usd" || prices[0].price_amount !== plan.list) {
      throw new Error(`${plan.label} Polar product ${productId}: expected one active fixed USD price of ${plan.list} cents; got ${JSON.stringify(prices)}`);
    }
    if (!discountId) throw new Error(`${plan.discountKey} is required while the site advertises the ${plan.launch}-cent launch price`);
    const discount = await get<PolarDiscount>(`discounts/${encodeURIComponent(discountId)}`);
    if (discount.id !== discountId || discount.duration !== "forever") {
      throw new Error(`${plan.label} Polar discount ${discountId}: expected duration forever; got ${discount.duration ?? "missing"}`);
    }
    if (discount.products?.length && !discount.products.some((entry) => entry.id === productId)) {
      throw new Error(`${plan.label} Polar discount ${discountId} does not apply to product ${productId}`);
    }
    const now = Date.now();
    if ((discount.starts_at && Date.parse(discount.starts_at) > now)
      || (discount.ends_at && Date.parse(discount.ends_at) <= now)
      || (discount.max_redemptions != null && (discount.redemptions_count ?? 0) >= discount.max_redemptions)) {
      throw new Error(`${plan.label} Polar discount ${discountId} is not currently redeemable`);
    }
    let effective: number | undefined;
    if (discount.type === "fixed") {
      const amount = discount.amounts?.usd ?? (discount.currency?.toLowerCase() === "usd" ? discount.amount : undefined);
      if (Number.isInteger(amount) && amount! >= 0) effective = Math.max(0, plan.list - amount!);
    } else if (discount.type === "percentage" && Number.isInteger(discount.basis_points)) {
      effective = Math.round(plan.list * (10_000 - discount.basis_points!) / 10_000);
    }
    if (effective !== plan.launch) {
      throw new Error(`${plan.label} Polar discount ${discountId}: expected ${plan.launch} cents after discount from ${plan.list} cents; got ${effective ?? "unsupported type/currency"} (type ${discount.type ?? "missing"})`);
    }
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required deployment environment variable: ${name}`);
  return value;
}

function requireConfig(source: string, value: string, description: string): void {
  if (!source.includes(value)) throw new Error(`Production config is missing ${description}: ${value}`);
}

function extractString(source: string, key: string): string {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  if (!match?.[1]) throw new Error(`Unable to read production config value for ${key}`);
  return match[1];
}

function assertNoSessionKvRequired(): void {
  if (/kv_namespaces|SESSION/i.test(productionPublicConfig) && /"binding"\s*:\s*"SESSION"/.test(productionPublicConfig)) {
    throw new Error(
      "Public production config declares a SESSION KV binding, but Astro sessions are intentionally disabled. Remove the binding or provision a real namespace id and update docs.",
    );
  }
  const astroConfig = readFileSync(join(root, "apps/public/astro.config.mjs"), "utf8");
  if (!astroConfig.includes("sessionDrivers.lruCache") && !astroConfig.includes("session: false")) {
    throw new Error(
      "apps/public/astro.config.mjs must explicitly disable unused Astro sessions (lruCache override) so hosted/self-host deploys do not require SESSION KV",
    );
  }
}

function runGate(label: string, command: string[], extraEnv: Record<string, string> = {}): void {
  console.log(`Running ${label}...`);
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Production preflight failed during ${label} (before any D1 mutation)`);
  }
}

async function runJson(command: string[]): Promise<unknown> {
  const result = await runWithNetworkRetry(command);
  if (result.status !== 0) {
    throw new Error(`Command failed (${command.join(" ")}): ${result.stderr || result.stdout}`);
  }
  const stdout = String(result.stdout).trim();
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

async function cloudflare<T>(path: string): Promise<{ ok: true; result: T } | { ok: false; detail: string }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await response.json()) as {
        success?: boolean;
        errors?: Array<{ message?: string; code?: number }>;
        result?: T;
      };
      if (!response.ok || !body.success) {
        const detail = body.errors?.map((error) => error.message).filter(Boolean).join(", ") || `HTTP ${response.status}`;
        return { ok: false, detail };
      }
      return { ok: true, result: body.result as T };
    } catch (error) {
      if (attempt === 3) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      await delay(attempt * 750);
    }
  }
  return { ok: false, detail: "Cloudflare API request failed" };
}

async function assertD1Exists(name: string, id: string, missing: string[]): Promise<void> {
  try {
    const listed = await runJson([
      "pnpm",
      "--filter",
      "@vc/api",
      "exec",
      "wrangler",
      "d1",
      "list",
      "--json",
    ]) as Array<{ name?: string; uuid?: string }> | null;
    const match = Array.isArray(listed) ? listed.find((db) => db.name === name || db.uuid === id) : undefined;
    if (!match) {
      missing.push(`D1 database ${name} (${id}) was not found in this Cloudflare account`);
      return;
    }
    if (match.uuid && match.uuid !== id) {
      missing.push(`D1 database ${name} exists as ${match.uuid} but production config expects ${id}`);
    }
  } catch (error) {
    missing.push(`Unable to list D1 databases: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertR2Exists(name: string, missing: string[]): Promise<void> {
  try {
    const listed = await runWithNetworkRetry([
      "pnpm",
      "--filter",
      "@vc/api",
      "exec",
      "wrangler",
      "r2",
      "bucket",
      "list",
    ]);
    if (listed.status !== 0) {
      missing.push(`Unable to list R2 buckets: ${listed.stderr || listed.stdout}`);
      return;
    }
    if (!listed.stdout.includes(name)) {
      missing.push(`R2 bucket ${name} was not found in this Cloudflare account`);
    }
  } catch (error) {
    missing.push(`Unable to list R2 buckets: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertAnalyticsDatasetConfigured(dataset: string, missing: string[]): Promise<void> {
  if (!productionPublicConfig.includes(`"dataset": "${dataset}"`)) {
    missing.push(`Analytics Engine dataset binding ${dataset} is missing from public production config`);
  }
  // Analytics Engine datasets are created lazily on first write; config + query var is the gate APIs allow.
  if (!productionApiConfig.includes(`"ANALYTICS_DATASET": "${dataset}"`)) {
    missing.push(`ANALYTICS_DATASET=${dataset} is missing from API production vars`);
  }
}

async function assertImagesBindingConfigured(missing: string[]): Promise<void> {
  if (!/"images"\s*:\s*\{\s*"binding"\s*:\s*"IMAGES"/.test(productionPublicConfig.replace(/\s+/g, ""))) {
    missing.push("Public production config is missing the IMAGES binding");
  }
}

async function assertEmailSendingConfigured(missing: string[]): Promise<void> {
  if (!productionApiConfig.includes('"send_email"') || !productionApiConfig.includes('"EMAIL"')) {
    missing.push("API production config is missing the EMAIL send_email binding");
    return;
  }
  const emailFromMatch = productionApiConfig.match(/"EMAIL_FROM"\s*:\s*"([^"]+)"/);
  const emailFrom = emailFromMatch?.[1] ?? "";
  const domainMatch = emailFrom.match(/@([A-Za-z0-9.-]+)/);
  const domain = domainMatch?.[1];
  if (!domain) {
    missing.push("EMAIL_FROM is missing or has no domain in API production vars");
    return;
  }
  const sending = await cloudflare<Array<{ name?: string; domain?: string; status?: string }>>(
    `/accounts/${accountId}/email/sending/domains`,
  );
  if (sending.ok) {
    const domains = sending.result ?? [];
    const found = domains.some((entry) => (entry.name || entry.domain) === domain);
    if (!found) {
      missing.push(`Email Sending domain ${domain} was not found (required for EMAIL_FROM=${emailFrom})`);
    }
    return;
  }
  console.warn(
    `Unable to verify Email Sending domain via API (${sending.detail}). EMAIL binding is declared; ensure ${domain} is onboarded before relying on OTP.`,
  );
}

async function assertCustomHostnameFallback(zone: string, missing: string[]): Promise<void> {
  const fallback = await cloudflare<{ origin?: string }>(`/zones/${zone}/custom_hostnames/fallback_origin`);
  if (!fallback.ok) {
    missing.push(
      `Custom hostname fallback origin could not be read for zone ${zone}: ${fallback.detail}. Enable Cloudflare for SaaS and run pnpm production:configure-hostnames.`,
    );
    return;
  }
  if (fallback.result?.origin !== "cname.vibecms.dev") {
    missing.push(
      `Custom hostname fallback origin is "${fallback.result?.origin ?? "missing"}" but expected cname.vibecms.dev`,
    );
  }
}

async function assertSecrets(missing: string[]): Promise<void> {
  try {
    const listed = await runJson([
      "pnpm",
      "--filter",
      "@vc/api",
      "exec",
      "wrangler",
      "secret",
      "list",
      "--env",
      "production",
      "--format",
      "json",
    ]) as Array<{ name: string }> | null;
    const secretNames = new Set((listed ?? []).map((secret) => secret.name));
    const requiredSecrets = [
      "BETTER_AUTH_SECRET",
      "TOKEN_PEPPER",
      "AUTOSEOPILOT_INTERNAL_SECRET",
      "POLAR_ACCESS_TOKEN",
      "POLAR_WEBHOOK_SECRET",
      "CACHE_PURGE_API_TOKEN",
      "ANALYTICS_API_TOKEN",
      "CUSTOM_HOSTNAME_API_TOKEN",
    ];
    for (const name of requiredSecrets) {
      if (!secretNames.has(name)) missing.push(`Worker secret ${name}`);
    }
  } catch (error) {
    missing.push(`Unable to list production Worker secrets: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runWithNetworkRetry(
  command: string[],
): Promise<ReturnType<typeof spawnSync>> {
  let result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  for (let attempt = 1; result.status !== 0 && attempt < 3; attempt += 1) {
    const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    if (!/fetch failed|connectivity issue|network/i.test(output)) break;
    await delay(attempt * 750);
    result = spawnSync(command[0]!, command.slice(1), {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
  }
  return result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
