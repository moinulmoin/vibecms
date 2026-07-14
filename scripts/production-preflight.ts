import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const apiConfig = readFileSync(new URL("../apps/api/wrangler.jsonc", import.meta.url), "utf8");
const publicConfig = readFileSync(new URL("../apps/public/wrangler.jsonc", import.meta.url), "utf8");
const productionApiConfig = apiConfig.slice(apiConfig.indexOf('"production"'));
const productionPublicConfig = publicConfig.slice(publicConfig.indexOf('"production"'));

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required deployment environment variable: ${name}`);
  return value;
}

function requireConfig(source: string, value: string, description: string): void {
  if (!source.includes(value)) throw new Error(`Production config is missing ${description}: ${value}`);
}

requireEnvironment("CLOUDFLARE_API_TOKEN");
requireEnvironment("CLOUDFLARE_ACCOUNT_ID");
if (!process.env.PRODUCTION_SMOKE_TOKEN?.trim() && process.env.ALLOW_BOOTSTRAP_SMOKE !== "1") {
  throw new Error("PRODUCTION_SMOKE_TOKEN is required unless ALLOW_BOOTSTRAP_SMOKE=1 is explicitly set for the first deploy");
}

requireConfig(productionApiConfig, '"app.vibecms.dev/*"', "the exact API app-host route");
requireConfig(productionApiConfig, '"CUSTOM_HOSTNAME_CNAME_TARGET": "cname.vibecms.dev"', "the custom-hostname CNAME target");
requireConfig(productionPublicConfig, '"*.vibecms.dev/*"', "the public wildcard route");
requireConfig(productionPublicConfig, '"service": "vibecms-api-prod"', "the public-to-API service binding");

for (const [name, source] of [
  ["API", productionApiConfig],
  ["public", productionPublicConfig],
] as const) {
  if (/REPLACE_ME|00000000-0000-0000-0000-000000000000|placeholder/i.test(source)) {
    throw new Error(`${name} production config still contains a placeholder`);
  }
}

const listed = spawnSync(
  "pnpm",
  ["--filter", "@vc/api", "exec", "wrangler", "secret", "list", "--env", "production", "--format", "json"],
  { cwd: new URL("..", import.meta.url), encoding: "utf8", env: process.env },
);
if (listed.status !== 0) {
  throw new Error(`Unable to list production Worker secrets: ${listed.stderr || listed.stdout}`);
}

const secrets = JSON.parse(listed.stdout) as Array<{ name: string }>;
const secretNames = new Set(secrets.map((secret) => secret.name));
const requiredSecrets = [
  "BETTER_AUTH_SECRET",
  "TOKEN_PEPPER",
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "CLOUDFLARE_ZONE_ID",
  "CACHE_PURGE_API_TOKEN",
  "CUSTOM_HOSTNAME_API_TOKEN",
];
const missingSecrets = requiredSecrets.filter((name) => !secretNames.has(name));
if (missingSecrets.length > 0) {
  throw new Error(`Missing production Worker secrets: ${missingSecrets.join(", ")}`);
}

console.log("Production preflight passed");
