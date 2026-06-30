# Contributing to vibecms

Thanks for helping improve vibecms.

## Local setup

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm build
```

For self-host development, copy the example env file and generate local secrets:

```sh
cp apps/web/dev.vars.example apps/web/.dev.vars
openssl rand -hex 32
```

Never commit `.env`, `.dev.vars`, Cloudflare credentials, Polar credentials, or generated API tokens.

## Get a dev API token (no email needed)

The seed creates a demo site and posts but no login or API token, so testing the authed surfaces (REST, MCP, CLI) would otherwise require the email-OTP flow. Mint a scoped token instead:

```sh
pnpm db:migrate:local && pnpm db:seed:local   # first time only, for local D1
pnpm dev:token                                 # full-scope token for demo_site on local D1
pnpm dev:token --remote                        # or against the deployed dev worker
pnpm dev:token --scopes draft                  # draft-only preset (no publish/archive)
pnpm dev:token --revoke                        # clean up (add --remote if you used it)
```

It prints the token once plus ready-to-paste REST, CLI, and MCP config. The hash uses `TOKEN_PEPPER` from `apps/web/.dev.vars`. Minted tokens are scoped and revocable; never commit them.

## Pull requests

- Keep changes focused.
- Add or update tests/checks when changing behavior.
- Keep human UI and MCP/API behavior routed through the same domain commands where possible.
- Mutations should create activity; meaningful post changes should create versions.
- Do not add new paid-service dependencies without explaining why they are needed.

## Product constraints

The hosted product is intentionally simple:

- one hosted blog per subscription
- unlimited posts
- 500MB trial media
- 5GB paid media
- image uploads only: JPEG, PNG, WebP, GIF
- no native video hosting
- no generic file hosting
