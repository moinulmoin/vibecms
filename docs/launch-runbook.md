# vibecms Cloud production launch

This runbook promotes the hosted two-Worker system to `app.vibecms.dev` and `*.vibecms.dev`. Self-hosting uses [`self-hosting.md`](./self-hosting.md).

## 1. Provision shared data resources

```sh
pnpm --filter @vc/api exec wrangler d1 create vibecms_prod
pnpm --filter @vc/api exec wrangler r2 bucket create vibecms-assets-prod
```

Put the resulting D1 id and R2 bucket name in both production environments:

- `apps/api/wrangler.jsonc`
- `apps/public/wrangler.jsonc`

Both Workers must point at the same database and bucket. Keep the public production service binding targeted at `vibecms-api-prod`.

## 2. Configure production hosts

API/dashboard production:

```txt
APP_URL=https://app.vibecms.dev
BETTER_AUTH_URL=https://app.vibecms.dev
PUBLIC_BLOG_DOMAIN=vibecms.dev
SELF_HOSTED=false
```

Public production uses the same `APP_URL` and `PUBLIC_BLOG_DOMAIN`. Keep the API route on `app.vibecms.dev`; keep the public Worker on `vibecms.dev` and `*.vibecms.dev/*`.

## 3. Configure API Worker secrets

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env production
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
```

Generate Better Auth and token-pepper values independently with `openssl rand -hex 32`. Rotating `TOKEN_PEPPER` invalidates every issued agent token.

Google sign-in is optional:

```sh
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

If enabled, authorize `https://app.vibecms.dev/api/auth/callback/google`.

## 4. Configure OTP email

The production API environment declares a native `EMAIL` send-email binding. Enable Cloudflare Email Sending for `vibecms.dev`, publish the supplied SPF/DKIM/DMARC records, and keep `EMAIL_FROM` on the onboarded domain.

```sh
pnpm --filter @vc/api exec wrangler email sending enable vibecms.dev --env production
```

Production treats a missing hosted email binding as an error; it never logs OTPs as a fallback.

## 5. Configure Polar

Set production product ids and `POLAR_SERVER=production` in the API production vars. Configure Polar's webhook target:

```txt
https://app.vibecms.dev/api/polar/webhook
```

The webhook secret must match `POLAR_WEBHOOK_SECRET`. Receipt ids and source timestamps make billing updates idempotent and monotonic.

## 6. Run release gates

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm public:audit
pnpm openapi:check
```

Do not deploy on a failed gate.

## 7. Deploy

```sh
pnpm deploy:prod
```

The script applies D1 migrations first, deploys `vibecms-api-prod`, then builds and deploys `vibecms-public-prod`. The API Worker must exist before the public service binding is deployed.

The manual GitHub Actions workflow `Deploy production` runs the same gates and sequence with an environment approval boundary.

## 8. Smoke test

1. `GET https://app.vibecms.dev/api/health/live` returns 200 and a Worker version id.
2. `GET https://app.vibecms.dev/api/health/ready` returns 200.
3. Complete email OTP sign-in and first-site onboarding.
4. Create a scoped token; run one MCP read and one approval-first draft/publish flow.
5. Open the published post on its public host and confirm HTML, feed, sitemap, robots, `llms.txt`, and `Accept: text/markdown` behavior.
6. Upload a valid image; reject an invalid image payload; verify the public media response is immutable and `nosniff`.
7. Complete Polar checkout and portal flows; replay a webhook id and verify it does not apply twice.
8. Confirm API logs correlate failures with `X-Request-ID` and contain no authorization, cookie, token, OTP, or request-body values.

## 9. Rollback

API and public versions roll back independently in Cloudflare. Roll back only the affected Worker when possible. D1 migrations are forward-only; before rolling API code back across a migration, verify the older code remains compatible with the current schema.
