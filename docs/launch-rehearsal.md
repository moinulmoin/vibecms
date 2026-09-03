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
- launch-offer monthly price: $19 -> $13/month
- launch-offer yearly price: $190 -> $99/year
- launch pricing applies automatically while the public early-access offer is displayed; continuous subscribers retain that rate
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

## 5. Remaining launch proof

- Production email OTP delivery from the onboarded domain; a successful OTP sign-in already verifies ownership
- One production Polar checkout, portal return, and replayed-webhook idempotency check
- One real Cloudflare-for-SaaS custom-domain provision, serve, and removal cycle
- One credentialed AutoSEOPilot provision, status, publish, rotate, and revoke lifecycle across both systems
- Authenticated deployed smoke for the exact reviewed release SHA

Newsletter double opt-in and delivery remain outside V1. The public capture form must continue to say that delivery is coming soon and must not imply that a pending address is subscribed.
