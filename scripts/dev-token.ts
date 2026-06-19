/**
 * dev:token - mint a scoped VibeCMS API token for local/dev testing without the
 * email-OTP dance. The seed creates a demo site + posts but no auth row and no
 * API key, so this is how a developer (or an agent) gets a working credential to
 * exercise the authed surfaces (REST, MCP, CLI).
 *
 *   pnpm dev:token                 # mint a full-scope token on the LOCAL D1 (demo_site)
 *   pnpm dev:token --remote        # mint against the deployed dev D1 (https://dev.vibecms.dev)
 *   pnpm dev:token --scopes draft  # draft-only preset (no publish/archive)
 *   pnpm dev:token --site <id>     # a site other than demo_site
 *   pnpm dev:token --revoke        # delete tokens this tool minted (add --remote for dev)
 *
 * Minted rows are marked with created_by_user_id = "dev-token" so --revoke is exact.
 * The token hash uses TOKEN_PEPPER from apps/web-next/.dev.vars, which matches both
 * the local worker and the deployed dev secret.
 */
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = "vibecms_dev";
const MARKER = "dev-token";

const SCOPE_PRESETS: Record<string, string[]> = {
  full: ["sites:read", "posts:read", "posts:create", "posts:update", "posts:publish", "posts:archive", "assets:write", "activity:read"],
  publish: ["sites:read", "posts:read", "posts:create", "posts:update", "posts:publish", "assets:write", "activity:read"],
  draft: ["sites:read", "posts:read", "posts:create", "posts:update", "assets:write", "activity:read"],
};

const argv = process.argv.slice(2);
const hasFlag = (f: string) => argv.includes(f);
function optvalue(flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : fallback;
}

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(
    [
      "pnpm dev:token - mint a scoped VibeCMS API token for testing (no email OTP needed)",
      "",
      "  pnpm dev:token                 mint a full-scope token on LOCAL D1 (demo_site)",
      "  pnpm dev:token --remote        mint against the deployed dev D1 (dev.vibecms.dev)",
      "  pnpm dev:token --scopes draft  draft-only preset (no publish/archive)",
      "  pnpm dev:token --scopes publish  publish preset (publish, no archive) - matches the app default",
      "  pnpm dev:token --site <id>     target a site other than demo_site",
      "  pnpm dev:token --name <label>  label the token (default: dev-token)",
      "  pnpm dev:token --revoke        delete tokens minted by this tool (add --remote for dev)",
      "",
      "Local needs the DB seeded first: pnpm db:migrate:local && pnpm db:seed:local",
    ].join("\n"),
  );
  process.exit(0);
}

const remote = hasFlag("--remote");
const target = remote ? "--remote" : "--local";
const where = remote ? "remote dev" : "local";
const base = remote ? "https://dev.vibecms.dev" : "http://localhost:3000";

function d1(sql: string): Array<{ results?: unknown[]; meta?: { changes?: number } }> {
  const out = execFileSync(
    "pnpm",
    ["--filter", "@vc/web-next", "exec", "wrangler", "d1", "execute", DB, target, "--json", "--command", sql],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const start = out.indexOf("["); // skip any wrangler preamble; --json result set is an array
  return JSON.parse(out.slice(start));
}

if (hasFlag("--revoke")) {
  const res = d1(`DELETE FROM api_keys WHERE created_by_user_id = '${MARKER}'`);
  console.log(`Revoked ${res[0]?.meta?.changes ?? 0} dev token(s) on ${where} D1.`);
  process.exit(0);
}

const siteId = optvalue("--site", "demo_site");
const name = optvalue("--name", "dev-token");
const preset = optvalue("--scopes", "full");
const scopes = SCOPE_PRESETS[preset];
if (!scopes) {
  console.error(`Unknown --scopes '${preset}'. Use 'full' or 'draft'.`);
  process.exit(2);
}

const site = d1(`SELECT id FROM sites WHERE id = '${siteId}' LIMIT 1`);
if (!site[0]?.results?.length) {
  console.error(`Site '${siteId}' not found on ${where} D1.`);
  if (!remote) console.error("Set up the local database first:\n  pnpm db:migrate:local && pnpm db:seed:local");
  process.exit(1);
}

function readPepper(): string {
  const txt = readFileSync(join(ROOT, "apps/web-next/.dev.vars"), "utf8");
  const m = txt.match(/^TOKEN_PEPPER=(.+)$/m);
  if (!m) throw new Error("TOKEN_PEPPER not found in apps/web-next/.dev.vars");
  return m[1].trim();
}

const token = `vc_test_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHmac("sha256", readPepper()).update(token).digest("base64url");
const id = `apikey_${MARKER}_${randomBytes(6).toString("hex")}`;
const now = Math.floor(Date.now() / 1000);

d1(
  "INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, created_by_user_id, created_at, updated_at) " +
    `VALUES ('${id}','${siteId}','${name}','${token.slice(0, 18)}','${tokenHash}','${JSON.stringify(scopes)}','${name}','${MARKER}',${now},${now})`,
);

let status = "";
try {
  const r = await fetch(`${base}/api/v1/site`, { headers: { Authorization: `Bearer ${token}` } });
  status = r.ok ? `token verified (HTTP ${r.status})` : `WARNING: auth returned HTTP ${r.status}`;
} catch {
  status = remote ? "could not reach dev to verify" : "local dev server not running - start it with `pnpm dev`, then retry the curl below";
}

const apiUrl = `${base}/api/v1`;
const mcpUrl = `${base}/mcp`;
console.log(
  [
    "",
    `  VibeCMS dev token  [${where} | site ${siteId} | scopes ${preset}]`,
    `  ${status}`,
    "",
    `  ${token}`,
    "",
    "  REST:",
    `    curl -s ${apiUrl}/posts -H "Authorization: Bearer ${token}"`,
    "",
    "  CLI (@vibecms/cli):",
    `    vibecms login --token ${token} --api-url ${apiUrl} && vibecms whoami`,
    `    # or: export VIBECMS_TOKEN=${token}; export VIBECMS_API_URL=${apiUrl}`,
    "",
    "  MCP (Claude Code):",
    `    claude mcp add --transport http vibecms ${mcpUrl} --header "Authorization: Bearer ${token}"`,
    "",
    "  MCP (any HTTP client, e.g. .mcp.json):",
    `    { "mcpServers": { "vibecms": { "type": "http", "url": "${mcpUrl}", "headers": { "Authorization": "Bearer ${token}" } } } }`,
    "",
    `  Revoke when done:  pnpm dev:token --revoke${remote ? " --remote" : ""}`,
    "",
  ].join("\n"),
);
