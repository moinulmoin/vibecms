/** Widen wrangler-inferred literal vars and declare optional secrets for agent API modules. */
declare namespace Cloudflare {
  interface Env {
    APP_ENV: string
    APP_URL: string
    BETTER_AUTH_URL: string
    PUBLIC_BLOG_DOMAIN: string
    SELF_HOSTED: string
    DB: D1Database
    ASSETS_BUCKET: R2Bucket
    BETTER_AUTH_SECRET?: string
    TOKEN_PEPPER?: string
    RESEND_API_KEY?: string
    EMAIL_FROM?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    API_USAGE_TEST_LIMIT?: string
    POLAR_ACCESS_TOKEN?: string
    POLAR_MONTHLY_PRODUCT_ID?: string
    POLAR_YEARLY_PRODUCT_ID?: string
    POLAR_PRODUCT_ID?: string
    POLAR_SERVER?: string
    CLOUDFLARE_ZONE_ID?: string
    CACHE_PURGE_API_TOKEN?: string
  }
}