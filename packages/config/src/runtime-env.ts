/**
 * Workers runtime environment - uses Cloudflare D1Database / R2Bucket globals.
 * Import from "@vc/config/runtime" only inside Workers entry points / packages
 * that run on the Workers runtime.  Platform-neutral packages (validators,
 * api-contract, core) must NOT import from here.
 */

export type AppEnv = "development" | "preview" | "production" | "test";

export type RuntimeEnv = {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  APP_ENV: AppEnv | string;
  APP_URL: string;
  PUBLIC_BLOG_DOMAIN: string;
  SELF_HOSTED?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_PRODUCT_ID?: string;
  POLAR_MONTHLY_PRODUCT_ID?: string;
  POLAR_YEARLY_PRODUCT_ID?: string;
  POLAR_SERVER?: "sandbox" | "production";
  TOKEN_PEPPER?: string;
  API_USAGE_TEST_LIMIT?: string;
};

const productionOnly = [
  "APP_URL",
  "PUBLIC_BLOG_DOMAIN",
  "TOKEN_PEPPER",
] as const;

const hostedProductionOnly = [
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "POLAR_PRODUCT_ID",
] as const;

export function assertRuntimeEnv(env: Partial<RuntimeEnv>): asserts env is RuntimeEnv {
  if (!env.DB) throw new Error("Missing DB binding");
  if (!env.ASSETS_BUCKET) throw new Error("Missing ASSETS_BUCKET binding");
  if (!env.APP_ENV) throw new Error("Missing APP_ENV");
  if (env.APP_ENV === "production") {
    for (const key of productionOnly) {
      if (!env[key]) throw new Error(`Missing required production env: ${key}`);
    }
    if (env.SELF_HOSTED !== "true") {
      for (const key of hostedProductionOnly) {
        if (!env[key]) throw new Error(`Missing required hosted production env: ${key}`);
      }
    }
  }
}
