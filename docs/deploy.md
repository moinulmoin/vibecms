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

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm public:audit
```

`pnpm build` builds dashboard assets first, validates the API Worker bundle, then builds the Astro Worker.

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

```sh
pnpm deploy:prod
```

Order is fixed:

1. Apply all D1 migrations with the API production environment.
2. Build dashboard assets.
3. Deploy `vibecms-api-prod` with `--env production`.
4. Build Astro with `CLOUDFLARE_ENV=production`.
5. Deploy the generated public production Worker config.

The API Worker must deploy before public because the public service binding targets it. The manual GitHub Actions workflow `.github/workflows/deploy-production.yml` runs typecheck, lint, tests, build, public audit, migration, and deployment in that order using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment secrets.

## Secrets

Set hosted API Worker secrets with the API package filter. Add `--env production` for production:

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET
```

Google OAuth secrets are optional. OTP delivery uses the native `EMAIL` send-email binding and `EMAIL_FROM` var.

## Health and rollback

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- API logs include `X-Request-ID`; unknown failures are logged with redaction.
- The API liveness response includes Worker version metadata.

Deployments are versioned independently. For a code-only rollback, roll back the affected Worker version. Database migrations are forward-only; inspect migration compatibility before rolling back code across a schema change.
