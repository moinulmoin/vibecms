// Fails the deploy if apps/public/dist was built for a different environment
// (e.g. a dev build left over from `pnpm deploy:dev`). Checks the Worker name
// and the D1 database it binds, so a mixed config can't slip through.
import { readFileSync } from "node:fs";

const [expectedWorker, expectedDatabase] = process.argv.slice(2);
const config = JSON.parse(readFileSync(new URL("../apps/public/dist/server/wrangler.json", import.meta.url), "utf8"));
const databases = (config.d1_databases ?? []).map((db) => db.database_name);
const problems = [];
if (config.name !== expectedWorker) problems.push(`Worker "${config.name}", expected "${expectedWorker}"`);
if (expectedDatabase && (databases.length !== 1 || databases[0] !== expectedDatabase)) {
  problems.push(`D1 ${JSON.stringify(databases)}, expected ["${expectedDatabase}"]`);
}
if (problems.length) {
  console.error(`apps/public/dist is built for the wrong environment: ${problems.join("; ")}. Rebuild with CLOUDFLARE_ENV set.`);
  process.exit(1);
}
console.log(`public build targets ${expectedWorker}${expectedDatabase ? ` / ${expectedDatabase}` : ""}`);
