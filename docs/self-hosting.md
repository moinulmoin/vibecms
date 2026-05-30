# Self-host VibeCMS on Cloudflare

VibeCMS can run without Polar in `SELF_HOSTED=true` mode. In this mode the app uses your Cloudflare Worker, D1 database, and R2 bucket, and billing gates are disabled.

## What self-hosted mode changes

```txt
SELF_HOSTED=true
```

- skips the Polar billing gate after onboarding
- treats the workspace as effectively active
- allows publishing, media uploads, MCP/API access, activity history, and post versions
- hides hosted checkout/customer-portal controls in settings
- ignores `/polar/webhook` payloads
- keeps image safety limits: JPEG/PNG/WebP/GIF only, 10MB max per image

Self-hosted mode still needs D1, R2, Better Auth, and the API token pepper.

## Required Cloudflare resources

```txt
Worker
D1 database bound as DB
R2 bucket bound as ASSETS_BUCKET
```

The root `wrangler.jsonc` is the source of truth for self-hosting. It declares `DB`, `ASSETS_BUCKET`, self-host vars, and required secrets. The hosted/dev Worker config remains in `apps/web/wrangler.jsonc` so private development resources do not leak into the public self-host config.

Once the repository is public, the README can expose this button:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/moinulmoin/vibecms)
```

Cloudflare's deploy flow should run the root `deploy` script:

```sh
pnpm deploy
```

That script builds the RedwoodSDK app with the root self-host Wrangler config, applies D1 migrations using the `DB` binding name, and deploys the generated Worker bundle.

## Required variables and secrets

Wrangler vars:

```txt
APP_ENV=production
APP_URL=https://<your-worker>.<your-subdomain>.workers.dev
BETTER_AUTH_URL=https://<your-worker>.<your-subdomain>.workers.dev
PUBLIC_BLOG_DOMAIN=<your-worker>.<your-subdomain>.workers.dev
SELF_HOSTED=true
```

Wrangler secrets:

```txt
BETTER_AUTH_SECRET=<random 32+ byte secret>
TOKEN_PEPPER=<random 32+ byte secret>
```

Generate secrets locally with:

```sh
openssl rand -hex 32
```

Then set them:

```sh
pnpm --filter @vc/web exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @vc/web exec wrangler secret put TOKEN_PEPPER
```

Do not set Polar secrets for self-hosted mode unless you intentionally want to test the hosted billing adapter.

## Manual deploy flow

1. Fork/clone the repo.
2. Update root `wrangler.jsonc` with your Worker name and public URL vars above.
3. If not using automatic provisioning, create D1/R2 and update the root `wrangler.jsonc` database/bucket values.
4. Set secrets:

```sh
pnpm --filter @vc/web exec wrangler secret put BETTER_AUTH_SECRET --config ../../wrangler.jsonc
pnpm --filter @vc/web exec wrangler secret put TOKEN_PEPPER --config ../../wrangler.jsonc
```

5. Apply migrations using the binding name:

```sh
pnpm db:migrate:self-host:remote
```

6. Deploy:

```sh
pnpm deploy
```

7. Open the deployed URL.
8. Create the first account.
9. Complete blog setup.
10. You should land directly on `/app` instead of `/app/billing`.

## One-click deploy target

The public COSS target is:

```txt
Click Deploy to Cloudflare
Cloudflare provisions D1/R2
User supplies APP_URL, BETTER_AUTH_SECRET, TOKEN_PEPPER
Migrations run
First account becomes owner
Dashboard opens without Polar
```

Before turning on the public deploy button, finish this release checklist:

- make the GitHub repo public
- replace the placeholder `https://github.com/moinulmoin/vibecms` button URL
- verify the Cloudflare deploy-button UI prompts cleanly for the URL vars and required secrets
- rotate/remove any local development secrets before publishing

`SELF_HOSTED=true` is the product-level switch that makes the app self-hostable without billing.
