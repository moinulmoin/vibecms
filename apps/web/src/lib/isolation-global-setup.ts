/**
 * Vitest global setup: runs in plain Node.js BEFORE the workers pool starts.
 * Reads all D1 migrations from packages/db/drizzle and provides them via
 * vitest's inject mechanism so isolation.test.ts can call applyD1Migrations.
 *
 * In vitest 4, globalSetup functions receive the TestProject as their first
 * argument. The project's `provide(key, value)` property is a stable reference
 * safe to destructure (which is why it is a property, not a method).
 */
import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const dir = dirname(fileURLToPath(import.meta.url));
  // From apps/web/src/lib/ -> ../../../../ -> repo root -> packages/db/drizzle
  const migrationsPath = resolve(dir, "../../../../packages/db/drizzle");
  const migrations = await readD1Migrations(migrationsPath);
  provide("migrations", migrations);
}
