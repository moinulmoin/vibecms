# Deploy vibecms Cloud

Hosted vibecms uses two Cloudflare Workers with separate failure domains:

- `vibecms-api-*`: Hono APIs, Better Auth, MCP, billing/webhooks, media writes, and static dashboard SPA assets.
- `vibecms-public-*`: Astro SSR for public blogs, feeds, search, media reads, and newsletter form forwarding.

Both Workers share D1/R2. The public Worker has a service binding named `API` targeting the API Worker.

## Configuration ownership

Keep hosted configuration in source control:

- `apps/api/wrangler.jsonc`
- `apps/public/wrangler.jsonc`

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

Preflight then builds production artifacts (dashboard, API production dry-run, public with `CLOUDFLARE_ENV=production`). A standalone `pnpm build` remains available for local verification and uses the development API dry-run env.

## Development deploy

```sh
pnpm deploy:dev
```

Order is fixed:

1. Sync the development `TOKEN_PEPPER`.
2. Apply D1 migrations to the development database.
3. Build dashboard assets.
4. Deploy `vibecms-api-dev`.
5. Build and deploy `vibecms-public-dev`.

## Production deploy

Canonical manual path:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_PREFLIGHT_API_TOKEN=<read-only-token> PRODUCTION_SMOKE_TOKEN=<read-token> pnpm deploy:prod
```

The local path uses an existing `wrangler login` OAuth session for backup,
migrations, and Worker deploys. Keep the verification token in
`CLOUDFLARE_PREFLIGHT_API_TOKEN`; setting a read-only token as
`CLOUDFLARE_API_TOKEN` overrides OAuth and blocks production writes. The
non-interactive GitHub workflow uses a deployment-capable
`CLOUDFLARE_API_TOKEN` for the full command instead.

Order is fixed and owned by `pnpm deploy:prod`:

1. `production:preflight` — validate typecheck/lint/tests/public audit/OpenAPI, confirm required D1/R2/Images/Analytics/Email/custom-hostname resources and secret names, then build all production artifacts (dashboard, API dry-run, public with `CLOUDFLARE_ENV=production`) before any D1 mutation.
2. `production:backup` — capture D1 time-travel bookmark/schema-export metadata and current Worker deployment version IDs (non-destructive).
3. Apply D1 migrations to production.
4. Deploy already-built `vibecms-prod` (the existing API Worker), then already-built `vibecms-public-prod`.
5. `production:smoke` — authenticated by default via `PRODUCTION_SMOKE_TOKEN`.

First deploy only (no tenant token yet): set `ALLOW_BOOTSTRAP_SMOKE=1` instead of `PRODUCTION_SMOKE_TOKEN`. That mode skips authenticated tenant/article checks and must not be reused later. After creating a site + read token + one published post, run `PRODUCTION_SMOKE_TOKEN=<token> pnpm production:smoke`, then require the token on every later deploy.

Astro sessions are intentionally disabled in `apps/public/astro.config.mjs` (Better Auth owns app sessions). Hosted and self-host configs do not need a `SESSION` KV namespace.

The GitHub workflow `.github/workflows/deploy-production.yml` is only a thin `workflow_dispatch` wrapper around the same `pnpm deploy:prod` path. It requires an explicit `smoke_mode` input (`authenticated` or `bootstrap`) and, for authenticated mode, the `PRODUCTION_SMOKE_TOKEN` environment secret. It does not implement a separate gate set.

## Secrets

Set hosted API Worker secrets against an explicit named environment:
The selected environment supplies the exact Worker name (`vibecms-api-dev` or
`vibecms-prod`). Do not combine `--env` with `--name`: Wrangler treats
`--name` as a base and appends the selected environment.


```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env development
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env development
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env development
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env development
```

Google OAuth secrets are optional. OTP delivery uses the native `EMAIL` send-email binding and `EMAIL_FROM` var.

## Health and rollback

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- API logs include `X-Request-ID`; unknown failures are logged with redaction.
- The API liveness response includes Worker version metadata.

Executable helpers (safe defaults are non-destructive):

```sh
pnpm production:backup
pnpm production:rollback
pnpm production:rollback -- --worker api --to <version-id> --yes
pnpm production:rollback -- --worker public --to <version-id> --yes
```

`production:rollback` with no flags only prints backup metadata, current Worker deployments, and D1 time-travel info. Worker rollback does not undo D1 writes. D1 migrations are forward-only; time-travel restore is destructive and requires explicit confirmation flags (`--d1-restore --i-understand-d1-restore-is-destructive --yes`). Do not treat that as a safe schema rollback.
