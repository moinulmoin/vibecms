# vibecms Cloud production launch

This runbook promotes the hosted two-Worker system to `app.vibecms.dev` and `*.vibecms.dev`. Self-hosting uses [`self-hosting.md`](./self-hosting.md).

## 1. Provision shared data resources

```sh
pnpm --filter @vc/api exec wrangler d1 create vibecms_prod
pnpm --filter @vc/api exec wrangler r2 bucket create vibecms-assets-prod
```

Put the resulting D1 id and R2 bucket name in both production environments:

- `apps/api/wrangler.jsonc`
- `apps/public/wrangler.jsonc`

Both Workers must point at the same database and bucket. Keep the existing API Worker named `vibecms-prod`; keep the public production service binding targeted at it.

Astro sessions are disabled in `apps/public/astro.config.mjs`; do not create a `SESSION` KV namespace for hosted production/dev or self-host unless you intentionally re-enable Astro sessions.

## 2. Configure production hosts

API/dashboard production:

```txt
APP_URL=https://app.vibecms.dev
BETTER_AUTH_URL=https://app.vibecms.dev
PUBLIC_BLOG_DOMAIN=vibecms.dev
SELF_HOSTED=false
```

Public production uses the same `APP_URL` and `PUBLIC_BLOG_DOMAIN`. Keep the API route on `app.vibecms.dev`; keep the public Worker on `vibecms.dev` and `*.vibecms.dev/*`.

## 3. Configure API Worker secrets

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env production
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
pnpm --filter @vc/api exec wrangler secret put CACHE_PURGE_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put ANALYTICS_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put CUSTOM_HOSTNAME_API_TOKEN --env production
```

Generate Better Auth and token-pepper values independently with `openssl rand -hex 32`. Rotating `TOKEN_PEPPER` invalidates every issued agent token.
The three Cloudflare API tokens should be narrowly scoped to their runtime jobs:

- `CACHE_PURGE_API_TOKEN`: purge cache for the production zone.
- `ANALYTICS_API_TOKEN`: read the configured Analytics Engine dataset.
- `CUSTOM_HOSTNAME_API_TOKEN`: create, inspect, and remove Cloudflare for SaaS custom hostnames.

Google sign-in is optional:

```sh
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

If enabled, authorize `https://app.vibecms.dev/api/auth/callback/google`.

## 4. Configure OTP email

The production API environment declares a native `EMAIL` send-email binding. Enable Cloudflare Email Sending for `vibecms.dev`, publish the supplied SPF/DKIM/DMARC records, and keep `EMAIL_FROM` on the onboarded domain.

```sh
pnpm --filter @vc/api exec wrangler email sending enable vibecms.dev --env production
```

Production treats a missing hosted email binding as an error; it never logs OTPs as a fallback.

## 5. Configure Polar

Set production product ids and `POLAR_SERVER=production` in the API production vars. Configure Polar's webhook target:

```txt
https://app.vibecms.dev/api/polar/webhook
```

The webhook secret must match `POLAR_WEBHOOK_SECRET`. Receipt ids and source timestamps make billing updates idempotent and monotonic.

## 6. Run the canonical production path

```sh
pnpm install --frozen-lockfile
CLOUDFLARE_ACCOUNT_ID=<account-id> \
CLOUDFLARE_API_TOKEN=<deploy-token> \
PRODUCTION_SMOKE_TOKEN=<read-token> \
pnpm deploy:prod
```

`deploy:prod` is the only hosted production path. It runs `production:preflight` (typecheck/lint/tests/public audit/OpenAPI + resource/secret checks + production artifact builds) before any D1 mutation, captures backup metadata, applies migrations, deploys API then already-built public, then smokes. Do not deploy on a failed preflight.

First deploy only: use `ALLOW_BOOTSTRAP_SMOKE=1` instead of `PRODUCTION_SMOKE_TOKEN`, then create a site/read token/published post and immediately run `PRODUCTION_SMOKE_TOKEN=<token> pnpm production:smoke`. Later deploys require the token.

Optional GitHub `workflow_dispatch` is a thin wrapper around the same command and requires an explicit `smoke_mode` input plus `PRODUCTION_SMOKE_TOKEN` for authenticated mode.

## 7. Post-deploy smoke checklist

`pnpm deploy:prod` already runs `production:smoke` (infrastructure always; authenticated tenant/article checks when `PRODUCTION_SMOKE_TOKEN` is set). Still verify the broader launch checklist:

1. `GET https://app.vibecms.dev/api/health/live` returns 200 and a Worker version id.
2. `GET https://app.vibecms.dev/api/health/ready` returns 200.
3. Complete email OTP sign-in and first-site onboarding.
4. Create a scoped token; run one MCP read and one approval-first draft/publish flow.
5. Open the published post on its public host and confirm HTML, feed, sitemap, robots, `llms.txt`, and `Accept: text/markdown` behavior.
6. Upload a valid image; reject an invalid image payload; verify the public media response is immutable and `nosniff`.
7. Complete Polar checkout and portal flows; replay a webhook id and verify it does not apply twice.
8. Confirm API logs correlate failures with `X-Request-ID` and contain no authorization, cookie, token, OTP, or request-body values.

## 8. Backup and rollback

```sh
pnpm production:backup
pnpm production:rollback
pnpm production:rollback -- --worker api --to <version-id> --yes
pnpm production:rollback -- --worker public --to <version-id> --yes
```

Backup defaults are non-destructive (bookmark + schema-export metadata + Worker version IDs). Rollback with no flags only prints status. API and public versions roll back independently; Worker rollback does not undo D1 schema or row changes. D1 migrations are forward-only; time-travel restore is destructive and is not a safe schema rollback.
