# Launch Rehearsal Checklist

Use this before widening public early access or running an announcement.

## 1. Secret safety

```sh
pnpm public:audit
```

Also check git history before publishing. If any production/dev secret ever touched git history, chat logs, screenshots, or CI logs, rotate it before launch.

Rotate at minimum if exposed:

- Better Auth secret
- API token pepper
- Polar access token
- Polar webhook secret
- Cloudflare API tokens

## 2. Hosted dev smoke

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm deploy:dev
```

## 3. Polar sandbox check

Confirm Polar sandbox product settings:

- standard monthly product: $19/month
- standard yearly product: $190/year
- founding monthly discount: $19 -> $13/month
- founding yearly discount: $190 -> $99/year
- founding discounts apply automatically; first 100 subscribers across both intervals share one eligibility pool
- card required
- webhook endpoint: `/polar/webhook`
- webhook events include subscription lifecycle events and `checkout.updated`

The app uses product IDs from Worker secrets/vars. It does not verify prices at runtime.

## 4. Deploy-to-Cloudflare rehearsal

After the repo is public, test the real button from a clean browser/account path:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/moinulmoin/vibecms)
```

Confirm:

- Cloudflare uses repo root
- build/deploy command is `pnpm deploy`
- D1 binding is `DB`
- R2 binding is `ASSETS_BUCKET`
- migrations in `packages/db/drizzle` run successfully
- required secrets are provided before deploy
- `APP_URL`, `BETTER_AUTH_URL`, and `PUBLIC_BLOG_DOMAIN` are changed from placeholders to the actual Worker URL
- first signup lands in setup, then `/dashboard`, not `/dashboard/billing`

## 5. Known deferred work

- Email verification enforcement before publishing
- Final brand/logo polish
