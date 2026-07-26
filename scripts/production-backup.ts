import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

requireEnvironment("CLOUDFLARE_API_TOKEN");
requireEnvironment("CLOUDFLARE_ACCOUNT_ID");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(root, ".wrangler/production-backup", stamp);
mkdirSync(outDir, { recursive: true });
mkdirSync(join(root, ".wrangler/production"), { recursive: true });

const timeTravel = runCapture([
  "pnpm",
  "--filter",
  "@vc/api",
  "exec",
  "wrangler",
  "d1",
  "time-travel",
  "info",
  "DB",
  "--env",
  "production",
  "--json",
]);

const schemaExportPath = join(outDir, "schema.sql");
const schemaExport = spawnSync(
  "pnpm",
  [
    "--filter",
    "@vc/api",
    "exec",
    "wrangler",
    "d1",
    "export",
    "DB",
    "--remote",
    "--env",
    "production",
    "--no-data",
    "--output",
    schemaExportPath,
    "--skip-confirmation",
  ],
  { cwd: root, encoding: "utf8", env: process.env },
);

const apiDeployments = runCapture([
  "pnpm",
  "--filter",
  "@vc/api",
  "exec",
  "wrangler",
  "deployments",
  "list",
  "--env",
  "production",
  "--json",
]);

const publicDeployments = runCapture([
  "pnpm",
  "--filter",
  "@vc/public",
  "exec",
  "wrangler",
  "deployments",
  "list",
  "--name",
  "vibecms-public-prod",
  "--json",
]);

const metadata = {
  capturedAt: new Date().toISOString(),
  purpose:
    "Non-destructive recovery bookmark + Worker version metadata captured before production D1 migrations/deploys",
  d1: {
    binding: "DB",
    environment: "production",
    timeTravelInfo: parseMaybeJson(timeTravel.stdout),
    timeTravelRaw: timeTravel.stdout.trim() || null,
    timeTravelError: timeTravel.status === 0 ? null : timeTravel.stderr || timeTravel.stdout,
    schemaExportPath: schemaExport.status === 0 ? schemaExportPath : null,
    schemaExportError: schemaExport.status === 0 ? null : schemaExport.stderr || schemaExport.stdout,
    notes: [
      "D1 migrations are forward-only. This bookmark/export metadata does not make schema rollback safe.",
      "Use wrangler d1 time-travel restore only with an explicit destructive confirmation via pnpm production:rollback.",
      "Full data export is intentionally not the default; capture one manually if you need row-level recovery.",
    ],
  },
  workers: {
    api: {
      name: "vibecms-prod",
      deployments: parseMaybeJson(apiDeployments.stdout),
      raw: apiDeployments.stdout.trim() || null,
      error: apiDeployments.status === 0 ? null : apiDeployments.stderr || apiDeployments.stdout,
    },
    public: {
      name: "vibecms-public-prod",
      deployments: parseMaybeJson(publicDeployments.stdout),
      raw: publicDeployments.stdout.trim() || null,
      error: publicDeployments.status === 0 ? null : publicDeployments.stderr || publicDeployments.stdout,
    },
  },
  rollbackCommands: {
    list: "pnpm production:rollback",
    apiWorker: "pnpm production:rollback -- --worker api --to <version-id> --yes",
    publicWorker: "pnpm production:rollback -- --worker public --to <version-id> --yes",
    d1RestoreWarning:
      "D1 schema/code rollback is not safe by default. See pnpm production:rollback -- --help",
  },
};

const metadataPath = join(outDir, "backup-metadata.json");
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(join(root, ".wrangler/production/last-backup.json"), `${JSON.stringify({ metadataPath, stamp }, null, 2)}\n`);

if (timeTravel.status !== 0) {
  console.warn(`Warning: D1 time-travel info failed:\n${timeTravel.stderr || timeTravel.stdout}`);
}
if (schemaExport.status !== 0) {
  console.warn(`Warning: D1 schema export failed:\n${schemaExport.stderr || schemaExport.stdout}`);
}
if (apiDeployments.status !== 0) {
  console.warn(`Warning: API deployments list failed:\n${apiDeployments.stderr || apiDeployments.stdout}`);
}
if (publicDeployments.status !== 0) {
  console.warn(`Warning: public deployments list failed:\n${publicDeployments.stderr || publicDeployments.stdout}`);
}

if (timeTravel.status !== 0 && apiDeployments.status !== 0 && publicDeployments.status !== 0) {
  throw new Error(`Unable to capture any production backup metadata. See ${metadataPath}`);
}

console.log(`Production backup metadata written to ${metadataPath}`);
console.log("Defaults are non-destructive. D1 schema rollback is not safe; Worker rollback is separate.");

function printHelp(): void {
  console.log(`production:backup — non-destructive recovery metadata capture

Usage:
  pnpm production:backup
  pnpm production:backup -- --help

Captures (no Worker deploy, no D1 restore, no schema mutation):
  - D1 time-travel bookmark/info for production DB
  - D1 schema-only export metadata (not a full data dump by default)
  - Current API and public Worker deployment/version IDs

Required environment:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID

Notes:
  - Defaults are non-destructive metadata only.
  - This does not make D1 schema rollback safe.
  - Worker rollback is separate: pnpm production:rollback -- --help
`);
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required deployment environment variable: ${name}`);
  return value;
}

function runCapture(command: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
