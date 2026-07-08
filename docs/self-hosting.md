# Self-host vibecms on Cloudflare

vibecms can run without Polar in `SELF_HOSTED=true` mode. In this mode the app uses your Cloudflare Worker, D1 database, and R2 bucket; billing gates and hosted workspace API quotas are not enforced by default.

## What self-hosted mode changes

```txt
SELF_HOSTED=true
```

- skips the Polar billing gate after onboarding
- treats the workspace as effectively active
- allows publishing, media uploads, MCP agent access, REST reads, activity history, and post versions without hosted quota enforcement
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

Self-hosting is meant to be easy for users who already know Cloudflare Workers, D1, and R2. It is not required for vibecms Cloud, and the launch path does not depend on perfect one-click self-hosting. A clean self-host deploy still needs real Cloudflare resources and secrets.

Once the repository is public, the README can expose a Deploy to Cloudflare button after the clean-account flow is rehearsed:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/moinulmoin/vibecms)
```

Cloudflare's deploy flow should run the root `deploy` script:

```sh
pnpm deploy
```

That script runs `pnpm build:self-host` (which sets `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=../../wrangler.jsonc` and builds `@vc/web`), applies D1 migrations with `pnpm db:migrate:self-host:remote`, and deploys with `wrangler deploy --config dist/server/wrangler.json`. If automatic provisioning does not create a real D1 database and R2 bucket for the user, they must create those resources and update root `wrangler.jsonc` first.

## Required variables and secrets

Wrangler vars (in root `wrangler.jsonc`):

```txt
APP_ENV=production
APP_URL=https://<your-worker>.<your-subdomain>.workers.dev
BETTER_AUTH_URL=https://<your-worker>.<your-subdomain>.workers.dev
PUBLIC_BLOG_DOMAIN=<your-worker>.<your-subdomain>.workers.dev
SELF_HOSTED=true
```

Self-host is **single-tenant and host-based**: the public blog serves at the root of its host (`/`, `/<post-slug>`, `/tag/<tag>`, `/feed.xml`, `/sitemap.xml`, `/robots.txt`, `/llms.txt`), and the host-mode resolver (`resolveSite`) returns the single tenant. Multi-tenant path-mode (`/blog/<site-slug>/*`) has been removed — there is no `PUBLIC_BLOG_URL_MODE` to set. With `PUBLIC_BLOG_DOMAIN` equal to `APP_URL` (the default single-host shape above), the app, dashboard, and blog share one Worker host. A future topology may split the app and blog onto separate hosts (e.g. `app.<your-domain>` + `<your-blog-domain>` or a wildcard); that is a pre-release decision (see `docs/url-architecture-decision.md`). `PUBLIC_BLOG_DOMAIN=localhost` is supported only for local development and is not a public URL.

Wrangler secrets:

```txt
BETTER_AUTH_SECRET=<random 32+ byte secret>
TOKEN_PEPPER=<random 32+ byte secret>
```

Generate secrets locally with:

```sh
openssl rand -hex 32
```

Then set them (from repo root, against the self-host config when using root wrangler):

```sh
pnpm --filter @vc/web exec wrangler secret put BETTER_AUTH_SECRET --config ../../wrangler.jsonc
pnpm --filter @vc/web exec wrangler secret put TOKEN_PEPPER --config ../../wrangler.jsonc
```

Do not set Polar secrets for self-hosted mode unless you intentionally want to test the hosted billing adapter.

## Sign-in (passwordless email + optional Google)

Sign-in is passwordless: users enter their email and receive a 6-digit code. Verifying the code creates the account on first use, so the email is always confirmed - there is no separate password to manage or reset.

To deliver codes by email in production, OTP email is sent through a native `send_email`
Workers binding named `EMAIL`, declared in `wrangler.jsonc` as
`"send_email": [{ "name": "EMAIL" }]`. No API token secret is needed — the Worker itself
is the sending identity — so there is no `wrangler secret put` step for email. Two things
are required instead:

1. Onboard **your own** sending domain to Cloudflare Email Sending and add the
   SPF/DKIM/DMARC records Cloudflare provides:

```sh
npx wrangler email sending enable <your-domain>
```

2. Set `EMAIL_FROM` (a var in `wrangler.jsonc`) to a sender on the domain you onboarded,
   e.g. `vibecms <login@yourdomain.com>`, and confirm the `EMAIL` `send_email` binding is
   present in your `wrangler.jsonc`.

When the `EMAIL` binding is present the Worker sends real email; without it, codes are
logged to the Worker console (`wrangler tail`) instead of emailed — useful for local
testing, not for real users.

To add a "Continue with Google" button, set both Google OAuth credentials as secrets (set both or omit both):

```sh
pnpm --filter @vc/web exec wrangler secret put GOOGLE_CLIENT_ID --config ../../wrangler.jsonc
pnpm --filter @vc/web exec wrangler secret put GOOGLE_CLIENT_SECRET --config ../../wrangler.jsonc
```

In the Google Cloud Console, set the authorized redirect URI to `<APP_URL>/api/auth/callback/google`. When the credentials are absent, the button is hidden and email sign-in is the only option.

## Manual deploy flow

1. Fork/clone the repo.
2. Create or select a Cloudflare D1 database and R2 bucket.
3. Update root `wrangler.jsonc` with your Worker name, real D1 database id, R2 bucket name, `SELF_HOSTED=true`, and the public URL vars above.
4. Set secrets (see above).
5. Deploy in one step from the repo root:

```sh
pnpm deploy
```

`pnpm deploy` is equivalent to:

```sh
pnpm build:self-host
pnpm db:migrate:self-host:remote
pnpm --filter @vc/web exec wrangler deploy --config dist/server/wrangler.json
```

6. Open the deployed URL.
7. Create the first account.
8. Complete blog setup.
9. You should land directly on `/dashboard` instead of `/dashboard/billing`.

Local migrations only (no deploy):

```sh
pnpm db:migrate:self-host:local
pnpm db:migrate:self-host:remote
```

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

Self-hosted MCP uses the same remote HTTP endpoint as hosted vibecms:

```txt
https://<your-worker>.<your-subdomain>.workers.dev/mcp
Authorization: Bearer vc_...
```

Hosted vibecms Cloud counts MCP and REST against the same workspace API quota. Self-hosted deployments can add their own limits, but vibecms does not enforce hosted quotas when `SELF_HOSTED=true`.

Create the token in Settings, copy it once, and pass it as the bearer token. Agents can write, draft, publish, upload media, and inspect activity only when the token has the matching scopes.