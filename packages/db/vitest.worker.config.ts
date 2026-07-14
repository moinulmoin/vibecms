import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflarePool, cloudflareTest } from "@cloudflare/vitest-pool-workers";

const root = path.dirname(fileURLToPath(import.meta.url));

const workerPoolOpts = {
  wrangler: { configPath: "./wrangler.test.jsonc" },
  miniflare: {
    // Text binding: makes API_USAGE_TEST_LIMIT=1 available via env in the
    // workers runtime, so planFor() returns a limit-of-1 plan for quota tests.
    bindings: { API_USAGE_TEST_LIMIT: "1" },
  },
};

export default defineConfig({
  plugins: [cloudflareTest(workerPoolOpts)],
  test: {
    name: "db-worker",
    include: ["src/__tests__/*.worker.test.ts"],
    pool: cloudflarePool(workerPoolOpts),
    globalSetup: ["./src/__tests__/isolation-global-setup.ts"],
  },
});
