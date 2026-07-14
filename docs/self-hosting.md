# Self-host vibecms on Cloudflare

vibecms runs without Polar when `SELF_HOSTED=true`. Hosted billing gates and workspace API quotas are disabled, while media safety limits, scoped tokens, activity, and post versions remain active.

## Topology

Self-hosting uses the same two-Worker boundary as vibecms Cloud:

1. **API + dashboard Worker**: Hono, Better Auth, REST, MCP, billing adapter, media writes, and the static TanStack Router SPA.
2. **Public Worker**: Astro SSR for blog pages, feeds, search, Markdown negotiation, and newsletter form forwarding.

Both Workers bind the same D1 database as `DB` and R2 bucket as `ASSETS_BUCKET`. The public Worker calls the API Worker through the `API` service binding. Public blog routes are host-based; the removed `/blog/<site-slug>/*` path mode is not supported.

Root `wrangler.jsonc` configures the API/dashboard Worker. Root `wrangler.public.jsonc` configures the Astro public Worker.

## Required resources

- Two Cloudflare Workers
- One D1 database, bound to both Workers as `DB`
- One R2 bucket, bound to both Workers as `ASSETS_BUCKET`
- One service binding named `API` from public to API
- A native `send_email` binding named `EMAIL` on the API Worker for real OTP delivery

Replace the placeholder D1 IDs, bucket names, Worker names, service target, and host variables in both root Wrangler configs before deploying.

## Variables and secrets

API/dashboard Worker variables:

```txt
APP_ENV=production
APP_URL=https://vibecms.<your-subdomain>.workers.dev
BETTER_AUTH_URL=https://vibecms.<your-subdomain>.workers.dev
PUBLIC_BLOG_DOMAIN=vibecms-public.<your-subdomain>.workers.dev
SELF_HOSTED=true
EMAIL_FROM=vibecms <login@your-domain.com>
```

The public Worker uses the same `APP_URL`, `PUBLIC_BLOG_DOMAIN`, and `SELF_HOSTED=true` values.

Set API Worker secrets from the repository root:

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --config ../../wrangler.jsonc
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --config ../../wrangler.jsonc
```

Generate each secret with `openssl rand -hex 32`. Do not configure Polar secrets unless you intentionally want to exercise hosted billing.

## Sign-in email and optional Google OAuth

Enable Cloudflare Email Sending for your sender domain, keep the `EMAIL` binding in root `wrangler.jsonc`, and set `EMAIL_FROM` to an address on that domain:

```sh
pnpm --filter @vc/api exec wrangler email sending enable <your-domain> --config ../../wrangler.jsonc
```

Without the binding, self-hosted OTP codes are written to Worker logs for operator testing; that is not suitable for real users.

Google sign-in is optional. Set both values or neither:

```sh
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_ID --config ../../wrangler.jsonc
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_SECRET --config ../../wrangler.jsonc
```

Use `<APP_URL>/api/auth/callback/google` as the authorized redirect URI.

## Deploy

From the repository root:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build:self-host
pnpm deploy
```

`pnpm deploy` performs this order:

1. Build dashboard assets and both Workers.
2. Apply all D1 migrations through root `wrangler.jsonc`.
3. Deploy the API/dashboard Worker.
4. Deploy the Astro public Worker generated from `wrangler.public.jsonc`.

The API Worker must deploy first because the public Worker service binding targets it.

After deploy, open `APP_URL`, create the first account, and complete blog setup. Self-hosted onboarding skips Polar and lands on `/dashboard`.

Local migration commands:

```sh
pnpm db:migrate:self-host:local
pnpm db:migrate:self-host:remote
```

## MCP

Agents connect to the API Worker:

```txt
https://vibecms.<your-subdomain>.workers.dev/mcp
Authorization: Bearer vc_...
```

Create the scoped token under **Dashboard → Connect** and copy it once. The same REST/MCP permission and approval-first publishing rules apply in hosted and self-hosted modes.

## Deploy button readiness

Before exposing a public Deploy to Cloudflare button, rehearse the two-Worker flow from a clean Cloudflare account and verify that D1/R2 provisioning, both host variables, secrets, the service binding, migrations, and deployment order are all handled correctly.
