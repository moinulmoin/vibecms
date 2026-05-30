# Contributing to VibeCMS

Thanks for helping improve VibeCMS.

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
