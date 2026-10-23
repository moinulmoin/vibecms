import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_readConfig } from "wrangler";

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const migrationsPath = resolve(dir, "../../../packages/db/drizzle");
  const migrations = await readD1Migrations(migrationsPath);
  provide("migrations", migrations);

  // Cron triggers exactly as each deploy resolves them (env inheritance included).
  const crons = (config: string, env?: string) =>
    unstable_readConfig({ config: resolve(dir, config), env }, { hideWarnings: true }).triggers?.crons ?? [];
  provide("deployedCrons", {
    development: crons("../wrangler.jsonc", "development"),
    production: crons("../wrangler.jsonc", "production"),
    selfHost: crons("../../../wrangler.jsonc"),
  });
}
