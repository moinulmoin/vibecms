/**
 * Vitest global setup: runs in plain Node.js BEFORE the workers pool starts.
 * Reads all D1 migrations from packages/db/drizzle and provides them via
 * vitest's inject mechanism so worker tests can call applyD1Migrations.
 */
import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const dir = dirname(fileURLToPath(import.meta.url));
  // From packages/db/src/__tests__/ -> ../../drizzle
  const migrationsPath = resolve(dir, "../../drizzle");
  const migrations = await readD1Migrations(migrationsPath);
  provide("migrations", migrations);
}
