/** Widen wrangler-inferred literal vars and declare optional secrets for agent API modules. */
declare namespace Cloudflare {
  interface Env {
    APP_ENV: string
    SELF_HOSTED: string
    TOKEN_PEPPER?: string
    API_USAGE_TEST_LIMIT?: string
    POLAR_ACCESS_TOKEN?: string
    POLAR_MONTHLY_PRODUCT_ID?: string
    POLAR_YEARLY_PRODUCT_ID?: string
  }
}