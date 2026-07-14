import { cloudflarePool, cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const workerPoolOptions = {
  wrangler: { configPath: "./wrangler.test.jsonc" },
};

export default defineConfig({
  plugins: [cloudflareTest(workerPoolOptions)],
  test: {
    include: ["src/**/*.test.ts"],
    pool: cloudflarePool(workerPoolOptions),
    globalSetup: ["./src/worker-global-setup.ts"],
  },
});
