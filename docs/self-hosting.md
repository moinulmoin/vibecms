# Self-host VibeCMS on Cloudflare

VibeCMS can run without Polar in `SELF_HOSTED=true` mode. In this mode the app uses your Cloudflare Worker, D1 database, and R2 bucket, and billing gates are disabled.

## What self-hosted mode changes

```txt
SELF_HOSTED=true
```

- skips the Polar billing gate after onboarding
- treats the workspace as effectively active
- allows publishing, media uploads, MCP agent access, REST reads, activity history, and post versions
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

The root `wrangler.jsonc` is the starting point for self-hosting. It declares `DB`, `ASSETS_BUCKET`, self-host vars, and required secrets. The hosted/dev Worker config remains in `apps/web/wrangler.jsonc` so private development resources do not leak into the public self-host config.

Self-hosting is meant to be easy for users who already know Cloudflare Workers, D1, and R2. It is not required for VibeCMS Cloud, and the launch path does not depend on perfect one-click self-hosting. A clean self-host deploy still needs real Cloudflare resources and secrets.

Once the repository is public, the README can expose a Deploy to Cloudflare button after the clean-account flow is rehearsed:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/moinulmoin/vibecms)
```

Cloudflare's deploy flow should run the root `deploy` script:

```sh
pnpm deploy
```

That script builds the RedwoodSDK app with the root self-host Wrangler config, applies D1 migrations using the `DB` binding name, and deploys the generated Worker bundle. If automatic provisioning does not create a real D1 database and R2 bucket for the user, they must create those resources and update `wrangler.jsonc` first.

## Required variables and secrets

Wrangler vars:

```txt
APP_ENV=production
APP_URL=https://<your-worker>.<your-subdomain>.workers.dev
BETTER_AUTH_URL=https://<your-worker>.<your-subdomain>.workers.dev
PUBLIC_BLOG_DOMAIN=<your-worker>.<your-subdomain>.workers.dev
SELF_HOSTED=true
```

When `PUBLIC_BLOG_DOMAIN` matches `APP_URL`, default blog URLs are served as `/blog/<site-slug>` on the Worker. If you set `PUBLIC_BLOG_DOMAIN` to a separate domain, route `*.PUBLIC_BLOG_DOMAIN` to the Worker and add matching DNS so default blog hostnames can use `<site-slug>.PUBLIC_BLOG_DOMAIN`. `PUBLIC_BLOG_DOMAIN=localhost` is supported only for local development and is not a public URL.

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
2. Create or select a Cloudflare D1 database and R2 bucket.
3. Update root `wrangler.jsonc` with your Worker name, real D1 database id, R2 bucket name, and public URL vars above. If `PUBLIC_BLOG_DOMAIN` is a separate domain from `APP_URL`, also add wildcard DNS and Worker routing for `*.PUBLIC_BLOG_DOMAIN`.
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

## Deploy button target

The self-host target is:

```txt
User brings or provisions Cloudflare resources
User supplies APP_URL, BETTER_AUTH_SECRET, TOKEN_PEPPER
Migrations run
First account becomes owner
Dashboard opens without Polar
```

Before turning on the public deploy button, finish this release checklist:

- make the GitHub repo public
- replace the placeholder `https://github.com/moinulmoin/vibecms` button URL if the owner/repo changes
- rehearse the Deploy to Cloudflare flow from a clean account
- verify the deploy UI prompts cleanly for URL vars and required secrets
- rotate/remove any local development secrets before publishing

`SELF_HOSTED=true` is the product-level switch that makes the app self-hostable without billing.

## MCP in self-hosted mode

Self-hosted MCP uses the same remote HTTP endpoint as hosted VibeCMS:

```txt
https://<your-worker>.<your-subdomain>.workers.dev/mcp
Authorization: Bearer vc_...
```

Create the token in Settings, copy it once, and pass it as the bearer token. Agents can write, draft, publish, upload media, and inspect activity only when the token has the matching scopes.
