import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const apiConfigPath = join(root, "apps/api/wrangler.jsonc");
const publicConfigPath = join(root, "apps/public/wrangler.jsonc");
const apiConfig = readFileSync(apiConfigPath, "utf8");
const publicConfig = readFileSync(publicConfigPath, "utf8");
const productionApiConfig = apiConfig.slice(apiConfig.indexOf('"production"'));
const productionPublicConfig = publicConfig.slice(publicConfig.indexOf('"production"'));

const accountId = requireEnvironment("CLOUDFLARE_ACCOUNT_ID");
const apiToken = requireEnvironment("CLOUDFLARE_API_TOKEN");

const smokeToken = process.env.PRODUCTION_SMOKE_TOKEN?.trim();
const bootstrapSmoke = process.env.ALLOW_BOOTSTRAP_SMOKE === "1";
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
  console.warn(
    "Bootstrap smoke mode enabled: authenticated tenant smoke will be skipped. After first deploy, create a read token and run PRODUCTION_SMOKE_TOKEN=<token> pnpm production:smoke before the next deploy.",
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
await assertR2Exists(r2Name, missing);
await assertAnalyticsDatasetConfigured(analyticsDataset, missing);
await assertImagesBindingConfigured(missing);
await assertEmailSendingConfigured(missing);
await assertCustomHostnameFallback(zoneId, missing);
await assertSecrets(missing);

if (missing.length > 0) {
  throw new Error(`Production preflight found missing resources/secrets:\n- ${missing.join("\n- ")}`);
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

function printHelp(): void {
  console.log(`production:preflight — production gates, resource/secret checks, and artifact builds

Usage:
  pnpm production:preflight
  pnpm production:preflight -- --help

Runs before any D1 mutation:
  - typecheck, lint, tests, public:audit, openapi:check
  - validates D1/R2/Images/Analytics/Email/custom-hostname resources and required secret names
  - builds dashboard, API production dry-run, and public production artifacts

Required environment:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  PRODUCTION_SMOKE_TOKEN   (authenticated mode)
  or ALLOW_BOOTSTRAP_SMOKE=1  (first deploy only; authenticated smoke must run later)

Notes:
  - Failures stop before migrations.
  - Astro sessions are disabled; no SESSION KV is required.
`);
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

function runJson(command: string[]): unknown {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${command.join(" ")}): ${result.stderr || result.stdout}`);
  }
  const stdout = result.stdout.trim();
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

async function cloudflare<T>(path: string): Promise<{ ok: true; result: T } | { ok: false; detail: string }> {
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
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function assertD1Exists(name: string, id: string, missing: string[]): Promise<void> {
  try {
    const listed = runJson([
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
    const listed = spawnSync(
      "pnpm",
      ["--filter", "@vc/api", "exec", "wrangler", "r2", "bucket", "list"],
      { cwd: root, encoding: "utf8", env: process.env },
    );
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
    const listed = runJson([
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

