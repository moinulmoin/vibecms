// Fails the deploy if apps/public/dist was built for a different environment
// (e.g. a dev build left over from `pnpm deploy:dev`). Checks the Worker name
// and that the bound D1 database (name and id) matches apps/public/wrangler.jsonc
// for that environment.
import { readFileSync } from "node:fs";

const [expectedWorker, expectedDatabase, env] = process.argv.slice(2);
const built = JSON.parse(readFileSync(new URL("../apps/public/dist/server/wrangler.json", import.meta.url), "utf8"));
const source = JSON.parse(
  readFileSync(new URL("../apps/public/wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1"),
);
const expectedConfig = env ? source.env?.[env] : source;
const expectedDb = (expectedConfig?.d1_databases ?? []).find((db) => db.database_name === expectedDatabase);
const builtDbs = built.d1_databases ?? [];

const problems = [];
if (built.name !== expectedWorker) problems.push(`Worker "${built.name}", expected "${expectedWorker}"`);
if (expectedDatabase) {
  if (!expectedDb) problems.push(`wrangler.jsonc has no "${expectedDatabase}" database for env "${env || "(top level)"}"`);
  else if (builtDbs.length !== 1 || builtDbs[0].database_name !== expectedDatabase || builtDbs[0].database_id !== expectedDb.database_id || builtDbs[0].binding !== expectedDb.binding) {
    problems.push(`D1 ${JSON.stringify(builtDbs.map((db) => [db.database_name, db.database_id]))}, expected [["${expectedDatabase}","${expectedDb.database_id}"]]`);
  }
}
if (problems.length) {
  console.error(`apps/public/dist is built for the wrong environment: ${problems.join("; ")}. Rebuild with CLOUDFLARE_ENV set.`);
  process.exit(1);
}
console.log(`public build targets ${expectedWorker}${expectedDatabase ? ` / ${expectedDatabase}` : ""}`);
