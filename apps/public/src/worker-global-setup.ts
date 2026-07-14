import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const migrationsPath = resolve(dir, "../../../packages/db/drizzle");
  const migrations = await readD1Migrations(migrationsPath);
  provide("migrations", migrations);
}
