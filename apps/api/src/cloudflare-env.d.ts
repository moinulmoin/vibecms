/** Widen Wrangler-inferred vars and declare secrets that never belong in wrangler.jsonc. */
declare namespace Cloudflare {
  interface Env {
    APP_ENV: string;
    APP_URL: string;
    BETTER_AUTH_URL: string;
    PUBLIC_BLOG_DOMAIN: string;
    SELF_HOSTED: string;
    DB: D1Database;
    ASSETS_BUCKET: R2Bucket;
    ASSETS: Fetcher;
    EMAIL: SendEmail;
    CF_VERSION_METADATA: WorkerVersionMetadata;
    TOKEN_PEPPER?: string;
    AUTOSEOPILOT_INTERNAL_SECRET?: string;
    BETTER_AUTH_SECRET?: string;
    EMAIL_FROM?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    API_USAGE_TEST_LIMIT?: string;
    POLAR_ACCESS_TOKEN?: string;
    POLAR_MONTHLY_PRODUCT_ID?: string;
    POLAR_YEARLY_PRODUCT_ID?: string;
    POLAR_SERVER?: string;
    POLAR_WEBHOOK_SECRET?: string;
    CLOUDFLARE_ZONE_ID?: string;
    CACHE_PURGE_API_TOKEN?: string;
    CUSTOM_HOSTNAME_API_TOKEN?: string;
    CUSTOM_HOSTNAME_CNAME_TARGET?: string;
    ANALYTICS_ACCOUNT_ID?: string;
    ANALYTICS_DATASET?: string;
    ANALYTICS_API_TOKEN?: string;
  }
}
