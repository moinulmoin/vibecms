// Read-only check after the new API is live: every published post must have a
// pinned version. Reads `wrangler d1 execute --json` output on stdin. Does not
// repair — an unpinned post here needs a human to pick the approved version.
import { readFileSync } from "node:fs";

const raw = readFileSync(0, "utf8");
const rows = JSON.parse(raw.slice(raw.indexOf("[")))?.[0]?.results ?? [];
if (rows.length) {
  console.error(`${rows.length} published post(s) have no pinned version (the old API published them during the cutover):`);
  for (const row of rows) console.error(`  ${row.id}  /${row.slug}`);
  console.error("Pin each to the version that was live (usually the newest created before the API deploy), then rerun smoke.");
  process.exit(1);
}
console.log("every published post has a pinned version");
