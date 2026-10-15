# Deploy vibecms Cloud

Hosted vibecms uses three Cloudflare Workers with separate failure domains:

- `vibecms-api-dev` / `vibecms-prod`: Hono APIs, Better Auth, MCP, billing/webhooks, media writes, and static dashboard SPA assets.
- `vibecms-og-dev` / `vibecms-og-prod`: internal share-card renderer (Takumi WASM and fonts), bound to public as `OG`.
- `vibecms-public-dev` / `vibecms-public-prod`: Astro SSR for public blogs, feeds, search, media reads, and newsletter form forwarding.

The API and public Workers share D1/R2. The public Worker has service bindings named `API` and `OG` targeting the API and OG Workers.

## Configuration ownership

Keep hosted configuration in source control:

- `apps/api/wrangler.jsonc`
- `apps/public/wrangler.jsonc`
- `apps/og/wrangler.jsonc`

Wrangler named environments do not inherit vars or most bindings. Production blocks therefore repeat D1, R2, routes, service/email/version bindings, and all production vars. Secrets remain in Cloudflare and are not committed.

Do not edit routes, bindings, or vars only in the Cloudflare dashboard; the next Wrangler deploy replaces them with source configuration.

## Local development

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

The dashboard Vite server proxies same-origin API routes to the local Hono Worker. Wrangler's local service registry connects the Astro public Worker to the API Worker.

## Verification gates

`pnpm deploy:prod` runs these inside `production:preflight` before any D1 mutation:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm public:audit
pnpm openapi:check
```

Preflight then builds production artifacts (dashboard, API and OG production dry-runs, public with `CLOUDFLARE_ENV=production`). A standalone `pnpm build` remains available for local verification and uses the development API dry-run env.

## Development deploy

```sh
pnpm deploy:dev
```

Order is fixed:

1. Sync the development `TOKEN_PEPPER`.
2. Apply D1 migrations to the development database.
3. Build dashboard assets.
4. Deploy `vibecms-api-dev`.
5. Deploy `vibecms-og-dev`.
6. Build and deploy `vibecms-public-dev`.

## Production deploy

Canonical hosted path: the reviewed-commit workflow
`.github/workflows/deploy-production.yml`, which checks out the exact commit
and runs `pnpm deploy:prod` (`scripts/deploy-prod.mjs`):

```sh
gh workflow run deploy-production.yml --ref main -f release_sha=<full 40-char sha> -f smoke_mode=authenticated
```

`release_sha` must be the full SHA of the reviewed release commit; the
workflow verifies the checkout matches it before deploying. `smoke_mode` is
explicit: `authenticated` requires the `PRODUCTION_SMOKE_TOKEN` environment
secret; `bootstrap` requires a temporary `PRODUCTION_BOOTSTRAP_SHA`
production environment secret equal to that same commit (first deploy only —
remove it immediately afterward). The workflow implements no separate gate
set.

`pnpm deploy:prod` is also the break-glass fallback when GitHub Actions is
unavailable: run it only from a clean checkout of the reviewed `main`
commit, using an existing `wrangler login` OAuth session for backup,
migrations, and Worker deploys. The workflow's `PRODUCTION_SMOKE_TOKEN`
environment secret must be supplied locally for authenticated smoke:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_PREFLIGHT_API_TOKEN=<read-only-token> PRODUCTION_SMOKE_TOKEN=<read-token> pnpm deploy:prod
```

Keep the verification token in `CLOUDFLARE_PREFLIGHT_API_TOKEN`; setting a
read-only token as `CLOUDFLARE_API_TOKEN` overrides OAuth and blocks
production writes. The workflow instead uses a deployment-capable
`CLOUDFLARE_API_TOKEN` for the full command.

Order is fixed and owned by `pnpm deploy:prod`:

1. `wrangler whoami` login refresh, then `production:preflight` — validate typecheck/lint/tests/public audit/OpenAPI, confirm required D1/R2/Images/Analytics/Email/custom-hostname resources and secret names, then build all production artifacts (dashboard, API and OG dry-runs, public with `CLOUDFLARE_ENV=production`) before any D1 mutation.
2. `production:backup` — capture D1 time-travel bookmark/schema-export metadata and current API/public Worker deployment version IDs (non-destructive).
3. Rebuild the dashboard and the public site (`CLOUDFLARE_ENV=production`) and assert the public build targets `vibecms-public-prod`/`vibecms_prod`.
4. If migration `0018_post_published_version` is still pending, confirm the write freeze and plan the one-time pin step (see RELEASING.md). Routine deploys skip this.
5. Apply D1 migrations to production; abort if any remain pending.
6. Deploy `vibecms-og-prod`, then `vibecms-public-prod`.
7. First cutover only: pin each live post's published version while the old API still serves.
8. Deploy `vibecms-prod` (API), verify every published post has a pinned version, then run `production:smoke` — authenticated via `PRODUCTION_SMOKE_TOKEN`.

## First deploy only

One-time provisioning for a fresh hosted stack. Routine deploys skip all of
this.

Create the shared data resources:

```sh
pnpm --filter @vc/api exec wrangler d1 create vibecms_prod
pnpm --filter @vc/api exec wrangler r2 bucket create vibecms-assets-prod
```

Put the resulting D1 id and bucket name in `env.production` of both
`apps/api/wrangler.jsonc` and `apps/public/wrangler.jsonc`; both Workers must
point at the same database and bucket.

A brand-new database has no tables. The deploy preflight requires existing
`user`, `posts`, and `post_versions` tables, so apply migrations once before
the first guarded deploy:

```sh
pnpm --filter @vc/api exec wrangler d1 migrations apply DB --remote --env production
```

Wildcard DNS and the custom-domain fallback origin need Cloudflare for SaaS
enabled on the `vibecms.dev` zone plus an API token with DNS Edit and SSL and
Certificates Edit:

```sh
CLOUDFLARE_ZONE_ID=<zone-id> CLOUDFLARE_API_TOKEN=<token> pnpm production:configure-hostnames
```

The idempotent command creates the proxied `*.vibecms.dev` tenant record,
creates `cname.vibecms.dev`, and sets that host as the Cloudflare for SaaS
fallback origin. `CUSTOM_HOSTNAME_CNAME_TARGET=cname.vibecms.dev` is
committed in the production Worker vars; when a customer CNAMEs to that
target, Cloudflare performs HTTP DV automatically.

The production API environment declares a native `EMAIL` send-email binding.
Enable Cloudflare Email Sending for `vibecms.dev`, publish the supplied
SPF/DKIM/DMARC records, and keep `EMAIL_FROM` on the onboarded domain:

```sh
pnpm --filter @vc/api exec wrangler email sending enable vibecms.dev --env production
```

Production treats a missing hosted email binding as an error; it never logs
OTPs as a fallback.

Set the Polar product ids and `POLAR_SERVER=production` in the API production
vars, and point Polar's webhook at
`https://app.vibecms.dev/api/polar/webhook` with a signing secret matching
`POLAR_WEBHOOK_SECRET`.

Bootstrap smoke (no tenant token yet): deploy with `ALLOW_BOOTSTRAP_SMOKE=1`
and `PRODUCTION_BOOTSTRAP_SHA=$(git rev-parse HEAD)` instead of
`PRODUCTION_SMOKE_TOKEN`. Preflight rejects bootstrap unless that full
reviewed SHA matches the checkout. Immediately remove the SHA after the
deploy, create a site + read token + one published post, and run
`PRODUCTION_SMOKE_TOKEN=<token> pnpm production:smoke`. Require the token on
every later deploy.

## Post-deploy smoke checklist

`pnpm deploy:prod` already runs `production:smoke` (infrastructure always;
authenticated tenant/article checks when `PRODUCTION_SMOKE_TOKEN` is set).
Verify the broader checklist once per launch and after any cross-system
change:

1. `GET https://app.vibecms.dev/api/health/live` returns 200 and a Worker version id.
2. `GET https://app.vibecms.dev/api/health/ready` returns 200.
3. `https://vibecms.dev` serves the marketing landing; `https://app.vibecms.dev/` redirects to the dashboard; `https://<slug>.vibecms.dev/` serves a tenant blog.
4. Complete email OTP sign-in and first-site onboarding.
5. Create a scoped token; run one MCP read and one approval-first draft/publish flow.
6. Open the published post on its public host and confirm HTML, feed, sitemap, robots, `llms.txt`, and `Accept: text/markdown` behavior.
7. Upload a valid image; reject an invalid image payload; verify the public media response is immutable and `nosniff`.
8. Complete Polar checkout and portal flows; replay a webhook id and verify it does not apply twice.
9. Confirm API logs correlate failures with `X-Request-ID` and contain no authorization, cookie, token, OTP, or request-body values.
10. Add and verify one real custom domain, then confirm HTML, Markdown, canonical metadata, media, and removal on that host.
11. Run the managed AutoSEOPilot lifecycle with production credentials: provision, status read, bearer REST/MCP use, generation rotation, revoke, denied reuse, and preserved customer content.

## Secrets

Set hosted API Worker secrets against an explicit named environment
(`development` selects `vibecms-api-dev`, `production` selects
`vibecms-prod`). Do not combine `--env` with `--name`: Wrangler treats
`--name` as a base and appends the selected environment.

Development:

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env development
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env development
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env development
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env development
```

Production:

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env production
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
pnpm --filter @vc/api exec wrangler secret put CACHE_PURGE_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put ANALYTICS_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put CUSTOM_HOSTNAME_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put AUTOSEOPILOT_INTERNAL_SECRET --env production
```

Generate `BETTER_AUTH_SECRET` and `TOKEN_PEPPER` independently with
`openssl rand -hex 32`; rotating `TOKEN_PEPPER` invalidates every issued
agent token. The three Cloudflare API tokens are narrowly scoped to their
jobs:

- `CACHE_PURGE_API_TOKEN`: purge cache for the production zone.
- `ANALYTICS_API_TOKEN`: read the configured Analytics Engine dataset.
- `CUSTOM_HOSTNAME_API_TOKEN`: create, inspect, and remove Cloudflare for
  SaaS custom hostnames (SSL and Certificates: Edit).

`AUTOSEOPILOT_INTERNAL_SECRET` is optional; it only enables the managed
`/internal/autoseopilot` routes and must be a separate high-entropy value
shared only with the AutoSEOPilot service.

Google and GitHub OAuth secrets are optional. Configure both the client ID and client secret for each provider you enable. OTP delivery uses the native `EMAIL` send-email binding and `EMAIL_FROM` var.

## Health and rollback

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- API logs include `X-Request-ID`; unexpected app, REST and MCP exceptions emit one `unhandled_exception` event with redacted message, stack and bounded causes. Client error responses do not expose those details.
- Scheduled publishing emits `scheduled_publish_failed` with post/site IDs and an error code for terminal failures, `scheduled_publish_retry` for retryable failures, and `scheduled_publish_run` counts (`attempted`, `published`, `failed`, plus retries and abandoned leases) on every tick, including empty runs and lease-bookkeeping failures. Terminal failures also create owner-visible `post.schedule_failed` activity.
- Dashboard static assets use `apps/dashboard/public/_headers`, copied to `apps/dashboard/dist/_headers`, for CSP, frame denial, nosniff, referrer policy, HSTS and noindex. The `/*` rule covers `/login` and deep dashboard SPA fallbacks in hosted and self-hosted builds; Worker-generated responses still use middleware.
- The API liveness response includes Worker version metadata.

Executable helpers (safe defaults are non-destructive):

```sh
pnpm production:backup
pnpm production:rollback
pnpm production:rollback -- --worker api --to <version-id> --yes
pnpm production:rollback -- --worker public --to <version-id> --yes
```

`production:rollback` with no flags only prints backup metadata, current API/public Worker deployments, and D1 time-travel info. Worker rollback does not undo D1 writes. D1 migrations are forward-only; time-travel restore is destructive and requires explicit confirmation flags (`--d1-restore --i-understand-d1-restore-is-destructive --yes`). Do not treat that as a safe schema rollback.

### Recovery point

The repository is public, so `deploy-production.yml` never uploads backup
files as artifacts. Before deploying, it writes the pre-deploy UTC timestamp to
the run's job summary. D1 Time Travel can restore to any timestamp in the last
30 days, so that timestamp is the recovery point:

```sh
pnpm production:rollback -- --d1-restore --timestamp <recovery-point> --i-understand-d1-restore-is-destructive --yes
```

Only run it after accepting that the restore is destructive. Worker versions
roll back with `--worker api|public --to <version-id> --yes`; list version IDs
with `wrangler versions list`.

## Deploy-button rehearsal

Before exposing the self-host Deploy to Cloudflare button, rehearse the flow
from a clean Cloudflare account and browser path:

- Cloudflare uses the repo root and the `pnpm deploy` build/deploy command.
- D1 binds as `DB`; R2 binds as `ASSETS_BUCKET`; migrations in
  `packages/db/drizzle` run successfully.
- `BETTER_AUTH_SECRET` and `TOKEN_PEPPER` are provided before deploy.
- `APP_URL`, `BETTER_AUTH_URL`, and `PUBLIC_BLOG_DOMAIN` are changed from
  placeholders to the actual Worker hostnames.
- First signup lands in setup, then `/dashboard` — not `/dashboard/billing`.
- The API Worker, optional OG Worker, and public Worker deploy in order and
  the `API`/`OG` service bindings resolve.

If any production or development secret ever touched git history, chat logs,
screenshots, or CI logs, rotate it before launch: `BETTER_AUTH_SECRET`,
`TOKEN_PEPPER`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, and every
Cloudflare API token.
