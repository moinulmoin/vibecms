/**
 * blog:suspend / blog:unsuspend - operator-only abuse suspension of one hosted
 * blog (runbook: docs/blog-suspension.md). Runs one statement against D1
 * through wrangler with the operator's own Cloudflare login; there is no HTTP
 * route and no dashboard screen for this.
 *
 *   pnpm blog:suspend <site-id-or-address> --env production --reason "Spam posts selling pills"
 *   pnpm blog:unsuspend <site-id-or-address> --env production
 *
 * --env development targets the deployed dev D1; add --local for the local
 * D1 under .wrangler/state. Nothing is deleted either way.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearSiteSuspensionSql,
  findSiteForSuspensionSql,
  SuspensionInputError,
  suspendSiteSql,
} from "../packages/db/src/site-suspension-sql.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATABASES = { production: "vibecms_prod", development: "vibecms_dev" } as const;

const argv = process.argv.slice(2);
const action = argv[0];
const flag = (name: string) => argv.includes(name);
function option(name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function usage(code: number): never {
  console.log(
    [
      "Operator abuse suspension (docs/blog-suspension.md)",
      "",
      "  pnpm blog:suspend <site-id-or-address> --env production|development --reason \"<why, the owner reads it>\" [--local]",
      "  pnpm blog:unsuspend <site-id-or-address> --env production|development [--local]",
    ].join("\n"),
  );
  process.exit(code);
}

if (flag("--help") || flag("-h") || (action !== "suspend" && action !== "clear")) usage(action ? 2 : 0);
const site = argv[1];
const envName = option("--env");
if (!site || site.startsWith("--") || (envName !== "production" && envName !== "development")) usage(2);
const local = flag("--local");

type Row = {
  id: string;
  slug: string;
  name: string;
  suspended_at: number | null;
  suspension_reason: string | null;
  suspension_notified_at: number | null;
};

function d1(sql: string): Array<{ results?: Row[] }> {
  const out = execFileSync(
    "pnpm",
    [
      "--filter", "@vc/api", "exec", "wrangler", "d1", "execute", DATABASES[envName], local ? "--local" : "--remote",
      "--env", envName, ...(local ? ["--persist-to", "../../.wrangler/state"] : []), "--json", "--command", sql,
    ],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(out.slice(out.indexOf("[")));
}

const where = `${envName}${local ? " (local)" : ""}`;
try {
  const matches = d1(findSiteForSuspensionSql(site))[0]?.results ?? [];
  if (matches.length !== 1) {
    console.error(matches.length ? `'${site}' matches more than one site on ${where}; pass the site id.` : `No site '${site}' on ${where}.`);
    process.exit(1);
  }
  const row = matches[0]!;
  const label = `${row.name} (${row.slug}, ${row.id}) on ${where}`;

  if (action === "suspend") {
    if (row.suspended_at !== null) {
      console.log(`Already suspended since ${new Date(row.suspended_at * 1000).toISOString()}: ${label}. Reason: ${row.suspension_reason ?? "none"}.`);
      process.exit(0);
    }
    const now = Math.floor(Date.now() / 1000);
    d1(suspendSiteSql(row.id, option("--reason") ?? "", now));
    // Local wrangler reports no row counts, so read the row back to confirm.
    const after = d1(findSiteForSuspensionSql(row.id))[0]?.results?.[0];
    if (after?.suspended_at !== now) {
      console.error(`Not suspended: ${label}. Run the command again to see its current state.`);
      process.exit(1);
    }
    console.log(`Suspended ${label}.`);
    console.log("Every address now serves the paused page; publish, schedule and upload are refused; nothing was deleted.");
    console.log("The owner email goes out and the public cache is purged on the next 15-minute cron.");
  } else {
    if (row.suspended_at === null) {
      console.log(`Not suspended: ${label}. Nothing to clear.`);
      process.exit(0);
    }
    d1(clearSiteSuspensionSql(row.id));
    if (d1(findSiteForSuspensionSql(row.id))[0]?.results?.[0]?.suspended_at !== null) {
      console.error(`Not cleared: ${label}. Run the command again to see its current state.`);
      process.exit(1);
    }
    console.log(`Cleared the suspension of ${label}. Every address serves again and writes are accepted.`);
  }
} catch (error) {
  if (error instanceof SuspensionInputError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}
