// Fails the deploy if apps/public/dist was built for a different environment
// (e.g. a dev build left over from `pnpm deploy:dev`).
import { readFileSync } from "node:fs";

const expected = process.argv[2];
const config = JSON.parse(readFileSync(new URL("../apps/public/dist/server/wrangler.json", import.meta.url), "utf8"));
if (config.name !== expected) {
  console.error(`apps/public/dist targets "${config.name}", expected "${expected}". Rebuild with CLOUDFLARE_ENV set.`);
  process.exit(1);
}
console.log(`public build targets ${expected}`);
