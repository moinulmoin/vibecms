// Pre-publish smoke test: pack the CLI, install the tarball into an empty
// project the way a user would, and run the installed `vibecms` bin.
// Runs from prepublishOnly, so a package that installs but cannot start
// (missing shebang, missing file, wrong version) never reaches npm.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "vibecms-cli-smoke-"));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

try {
  run("pnpm", ["pack", "--pack-destination", tmp], pkgDir);
  const tarball = readdirSync(tmp).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack produced no tarball");

  const app = join(tmp, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), '{"private":true}\n');
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", join(tmp, tarball)], app);

  // Execute the bin file itself (not `node dist/index.js`) so the shebang is exercised.
  const bin = join(app, "node_modules", ".bin", "vibecms");
  const printed = run(bin, ["--version"], app).trim();
  if (printed !== version) throw new Error(`vibecms --version printed "${printed}", expected "${version}"`);
  const operations = JSON.parse(run(bin, ["schema"], app));
  if (!Array.isArray(operations) || operations.length === 0) throw new Error("vibecms schema returned no operations");

  console.log(`smoke ok: vibecms-cli@${version} installs and runs (${operations.length} operations)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
