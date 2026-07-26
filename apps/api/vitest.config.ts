import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflarePool, cloudflareTest } from "@cloudflare/vitest-pool-workers";

const root = path.dirname(fileURLToPath(import.meta.url));
const workerPoolOpts = {
  wrangler: { configPath: "./wrangler.test.jsonc" },
  miniflare: {
    bindings: { API_USAGE_TEST_LIMIT: "1" },
  },
};

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  plugins: [cloudflareTest(workerPoolOpts)],
  test: {
    include: ["src/**/*.test.ts"],
    pool: cloudflarePool(workerPoolOpts),
    globalSetup: ["./src/worker-global-setup.ts"],
  },
});
