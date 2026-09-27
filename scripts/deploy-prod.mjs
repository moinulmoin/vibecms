// Production deploy. Order matters for the first cutover to the versioned
// model (migration 0018): the old API keeps serving until the new one deploys.
//
//   write freeze ack → preflight → backup → builds (checked) → migrations
//   → OG → public → [first cutover only: pin live versions] → API
//   → verify every published post is pinned (fail closed) → smoke
//
// The pin runs only when 0018 was still pending when this run started, i.e.
// while the old API is live and a post's latest version is its live content.
// A rerun after a partial failure never pins: by then the new API may be live
// and a latest version can be a private draft. `--verify-pins` runs only the
// read-only check.
import { spawnSync } from "node:child_process";

const API = ["--filter", "@vc/api", "exec", "wrangler"];
const REMOTE_PROD = ["--remote", "--env", "production"];

function run(label, args, { capture = false } = {}) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync("pnpm", args, { stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`\n✖ Stopped at: ${label}. Nothing after this step ran.`);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function node(label, script, args = []) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync("node", [script, ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✖ Stopped at: ${label}. Nothing after this step ran.`);
    process.exit(result.status ?? 1);
  }
}

function d1Json(label, sql) {
  const out = run(label, ["-s", ...API, "d1", "execute", "DB", ...REMOTE_PROD, "--json", "--command", sql], { capture: true });
  let parsed;
  try {
    parsed = JSON.parse(out.slice(out.indexOf("[")));
  } catch {
    console.error(`✖ ${label}: could not parse D1 output`);
    process.exit(1);
  }
  const first = Array.isArray(parsed) ? parsed[0] : undefined;
  if (!first || first.success !== true || !Array.isArray(first.results)) {
    console.error(`✖ ${label}: query did not succeed: ${JSON.stringify(first ?? parsed).slice(0, 300)}`);
    process.exit(1);
  }
  return first.results;
}

function verifyPins() {
  const rows = d1Json(
    "Verify every published post has a pinned version",
    "SELECT id, slug FROM posts WHERE status = 'published' AND published_version_id IS NULL",
  );
  if (rows.length) {
    console.error(`✖ ${rows.length} published post(s) have no pinned version:`);
    for (const row of rows) console.error(`  ${row.id}  /${row.slug}`);
    console.error("Pin each to the version that was live, then run `pnpm deploy:prod -- --verify-pins` and smoke. Do not rerun the pin.");
    process.exit(1);
  }
  console.log("✓ every published post has a pinned version");
}

if (process.argv.includes("--verify-pins")) {
  verifyPins();
  process.exit(0);
}

node("Confirm content write freeze", "scripts/assert-write-freeze.mjs");
run("Production preflight", ["production:preflight"]);
run("Backup production D1", ["production:backup"]);
run("Build dashboard", ["--filter", "@vc/dashboard", "build"]);
process.env.CLOUDFLARE_ENV = "production";
run("Build public site for production", ["--filter", "@vc/public", "build"]);
delete process.env.CLOUDFLARE_ENV;
node("Check public build targets production", "scripts/assert-public-build-target.mjs", ["vibecms-public-prod", "vibecms_prod", "production"]);

const pending = run("List pending production migrations", ["-s", ...API, "d1", "migrations", "list", "DB", ...REMOTE_PROD], { capture: true });
const firstCutover = /0018_post_published_version/.test(pending);
console.log(firstCutover ? "First cutover to versioned posts: will pin live versions before the API deploys." : "Versioned model already live: no pin step.");

run("Apply production migrations", [...API, "d1", "migrations", "apply", "DB", ...REMOTE_PROD]);
run("Deploy OG worker", ["--filter", "@vc/og", "exec", "wrangler", "deploy", "--env", "production"]);
run("Deploy public worker", ["--filter", "@vc/public", "exec", "wrangler", "deploy", "--config", "dist/server/wrangler.json"]);
if (firstCutover) {
  run("Pin live versions (old API still serving)", [...API, "d1", "execute", "DB", ...REMOTE_PROD, "--file", "../../scripts/prod-pin-before-api-cutover.sql"]);
}
run("Deploy API worker", [...API, "deploy", "--env", "production"]);
verifyPins();
run("Production smoke test", ["production:smoke"]);
console.log("\n✓ Production deploy complete. Reopen content writes.");
