import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflarePool, cloudflareTest } from "@cloudflare/vitest-pool-workers";

const workerPoolOpts = {
  wrangler: { configPath: "./wrangler.test.jsonc" },
  miniflare: {
    // Text binding: makes API_USAGE_TEST_LIMIT=1 available via env in the
    // workers runtime, so planFor() returns a limit-of-1 plan for quota tests.
    bindings: { API_USAGE_TEST_LIMIT: "1" },
  },
};

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the Vite alias so worker test bundles can resolve ~/server/...
      "~": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src"),
    },
  },
  plugins: [cloudflareTest(workerPoolOpts)],
  test: {
    name: "isolation",
    include: ["src/**/*.worker.test.ts"],
    pool: cloudflarePool(workerPoolOpts),
    // Global setup reads migrations in Node.js (where node:fs is unrestricted)
    // and provides them via vitest's inject() mechanism to the workers tests.
    globalSetup: ["./src/lib/isolation-global-setup.ts"],
  },
});
