import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const worker = readOption(args, "--worker");
const toVersion = readOption(args, "--to");
const yes = args.includes("--yes");
const d1Restore = args.includes("--d1-restore");
const bookmark = readOption(args, "--bookmark");
const timestamp = readOption(args, "--timestamp");
const understand = args.includes("--i-understand-d1-restore-is-destructive");

requireEnvironment("CLOUDFLARE_API_TOKEN");
requireEnvironment("CLOUDFLARE_ACCOUNT_ID");

if (!worker && !d1Restore) {
  printStatus();
  process.exit(0);
}

if (worker) {
  if (worker !== "api" && worker !== "public") {
    throw new Error(`--worker must be api or public (received ${worker})`);
  }
  if (!toVersion) {
    throw new Error("--to <version-id> is required for Worker rollback");
  }
  if (!yes) {
    throw new Error("Refusing Worker rollback without --yes (default is non-destructive status only)");
  }

  const command =
    worker === "api"
      ? [
          "pnpm",
          "--filter",
          "@vc/api",
          "exec",
          "wrangler",
          "rollback",
          toVersion,
          "--env",
          "production",
          "--yes",
          "--message",
          "production:rollback api worker",
        ]
      : [
          "pnpm",
          "--filter",
          "@vc/public",
          "exec",
          "wrangler",
          "rollback",
          toVersion,
          "--name",
          "vibecms-public-prod",
          "--yes",
          "--message",
          "production:rollback public worker",
        ];

  console.log(`Rolling back ${worker} Worker to ${toVersion}...`);
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${worker} Worker rollback failed`);
  }
  console.log(`${worker} Worker rollback requested. Verify /api/health/live and public /__vc-health.`);
}

if (d1Restore) {
  console.error("D1 restore is separate from Worker rollback and is destructive to later writes.");
  console.error("D1 migrations are forward-only; this is NOT a safe schema rollback.");
  if (!understand || !yes) {
    throw new Error(
      "Refused. D1 restore requires --d1-restore --i-understand-d1-restore-is-destructive --yes and either --bookmark or --timestamp",
    );
  }
  if (!bookmark && !timestamp) {
    throw new Error("Provide --bookmark <id> or --timestamp <RFC3339/unix>");
  }
  const command = [
    "pnpm",
    "--filter",
    "@vc/api",
    "exec",
    "wrangler",
    "d1",
    "time-travel",
    "restore",
    "DB",
    "--env",
    "production",
    ...(bookmark ? ["--bookmark", bookmark] : []),
    ...(timestamp ? ["--timestamp", timestamp] : []),
  ];
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("D1 time-travel restore failed");
  }
}

function printHelp(): void {
  console.log(`production:rollback — safe defaults print status only

Usage:
  pnpm production:rollback
  pnpm production:rollback -- --worker api|public --to <version-id> --yes
  pnpm production:rollback -- --d1-restore --bookmark <id> --i-understand-d1-restore-is-destructive --yes
  pnpm production:rollback -- --d1-restore --timestamp <RFC3339> --i-understand-d1-restore-is-destructive --yes

Notes:
  - Default invocation never mutates Cloudflare state.
  - Worker rollback does not undo D1 migrations or row writes.
  - D1 time-travel restore is destructive and is not a schema-migration rollback.
`);
}

function printStatus(): void {
  console.log("Production rollback status (non-destructive default)\n");

  const lastBackupPath = join(root, ".wrangler/production/last-backup.json");
  if (existsSync(lastBackupPath)) {
    console.log(`Last backup pointer: ${lastBackupPath}`);
    console.log(readFileSync(lastBackupPath, "utf8"));
  } else {
    console.log("No local backup pointer found. Run pnpm production:backup before mutate/deploy.\n");
  }

  console.log("Current API deployments:");
  runInherit([
    "pnpm",
    "--filter",
    "@vc/api",
    "exec",
    "wrangler",
    "deployments",
    "list",
    "--env",
    "production",
  ]);

  console.log("\nCurrent public deployments:");
  runInherit([
    "pnpm",
    "--filter",
    "@vc/public",
    "exec",
    "wrangler",
    "deployments",
    "list",
    "--name",
    "vibecms-public-prod",
  ]);

  console.log("\nD1 time-travel info:");
  runInherit([
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
  ]);

  console.log(`
Safe next steps:
  - Code-only rollback: pnpm production:rollback -- --worker api --to <version-id> --yes
  - Public-only rollback: pnpm production:rollback -- --worker public --to <version-id> --yes
  - Do not treat Worker rollback as D1 schema rollback.
  - D1 restore is destructive and requires explicit confirmation flags (see --help).
`);
}

function runInherit(command: string[]): void {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.warn(`Command failed: ${command.join(" ")}`);
  }
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required deployment environment variable: ${name}`);
  return value;
}
