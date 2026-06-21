# Production Launch Runbook

Ordered, copy-pasteable steps. Run from the repo root unless a directory is specified.
All `wrangler` commands run through pnpm to pick up the locally installed version.

Prereqs: Cloudflare account upgraded to Workers Paid ($5/mo), `wrangler login` authenticated.

---

## Step 1 - Create the prod D1 database

```bash
pnpm --filter @vc/web-next exec wrangler d1 create vibecms_prod
```

Copy the `database_id` from the output, then update `apps/web-next/wrangler.jsonc`:

```jsonc
// env.production -> d1_databases[0]
"database_id": "<paste id here>"
```

Commit that change before proceeding.

---

## Step 2 - Create the prod R2 bucket

```bash
pnpm --filter @vc/web-next exec wrangler r2 bucket create vibecms-assets-prod
```

No config change needed - the bucket name `vibecms-assets-prod` is already in `wrangler.jsonc env.production`.

---

## Step 3 - Set all required secrets

Run each command and paste the secret value when prompted.
All commands target `--env production` so they are stored against the prod environment only.

```bash
# Token pepper - generate: openssl rand -hex 32
pnpm --filter @vc/web-next exec wrangler secret put TOKEN_PEPPER --env production

# Better Auth secret - generate: openssl rand -hex 32
pnpm --filter @vc/web-next exec wrangler secret put BETTER_AUTH_SECRET --env production

# Google OAuth (created at console.cloud.google.com - add https://app.vibecms.dev/api/auth/callback/google)
pnpm --filter @vc/web-next exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm --filter @vc/web-next exec wrangler secret put GOOGLE_CLIENT_SECRET --env production

# Plunk email delivery (app.plunk.com - verify the ideaplexa.com domain if not already done)
pnpm --filter @vc/web-next exec wrangler secret put PLUNK_API_KEY --env production

# Polar billing (see Step 4 below for POLAR_PRODUCT_ID - set access token + webhook secret now)
pnpm --filter @vc/web-next exec wrangler secret put POLAR_ACCESS_TOKEN --env production
pnpm --filter @vc/web-next exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
```

Cache purge secrets (required to enable zone-level CDN cache invalidation on publish/archive):

```bash
# Cloudflare zone ID - find in the vibecms.dev zone overview in the CF dashboard
pnpm --filter @vc/web-next exec wrangler secret put CLOUDFLARE_ZONE_ID --env production

# CF API token with Cache Purge permission scoped to vibecms.dev
# Create at: dash.cloudflare.com/profile/api-tokens -> "Create Token" -> "Cache Purge" template
pnpm --filter @vc/web-next exec wrangler secret put CACHE_PURGE_API_TOKEN --env production
```

---

## Step 4 - Create Polar prod products [GATED ON PRICING DECISION]

> **This step is blocked until the $19/mo and $190/yr prices are confirmed.**
> Do not proceed past this step until the pricing decision is made.
> Deploy in Step 6 can still run without billing configured; the Upgrade flow will
> return `polar_unconfigured` until these are set.

Once prices are decided:

1. Log into polar.sh -> your organization -> Products -> Create Product.
2. Create a monthly product at $19/mo. Copy the product id.
3. Create a yearly product at $190/yr. Copy the product id.
4. Update `apps/web-next/wrangler.jsonc` env.production vars:
   ```jsonc
   "POLAR_PRODUCT_ID": "<monthly product id>"
   ```
   Commit and redeploy, OR set as a secret to override the var without redeploying:
   ```bash
   pnpm --filter @vc/web-next exec wrangler secret put POLAR_PRODUCT_ID --env production
   pnpm --filter @vc/web-next exec wrangler secret put POLAR_MONTHLY_PRODUCT_ID --env production
   pnpm --filter @vc/web-next exec wrangler secret put POLAR_YEARLY_PRODUCT_ID --env production
   ```
5. In the Polar dashboard, add the webhook endpoint:
   - URL: `https://app.vibecms.dev/api/polar/webhook`
   - Events: `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.revoked`
   - Copy the signing secret and set it: (already done in Step 3 if you ran it then, otherwise run now)
     ```bash
     pnpm --filter @vc/web-next exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
     ```

---

## Step 5 - Add the wildcard DNS record

In the Cloudflare dashboard for `vibecms.dev`:

1. DNS -> Add record:
   - Type: `A` (or `AAAA` / `CNAME` - value does not matter, Workers intercept all traffic)
   - Name: `*`
   - IPv4 address: `192.0.2.1`  (discard address; Workers intercept before it is reached)
   - Proxy status: **Proxied** (orange cloud - required)

This record allows `<slug>.vibecms.dev` requests to reach Cloudflare so the `*.vibecms.dev/*`
wrangler route can dispatch them to the worker. Without this record no DNS resolution occurs.

Note: `app.vibecms.dev` is handled automatically by the `custom_domain: true` entry in
wrangler.jsonc - wrangler creates and manages that DNS record on deploy.

---

## Step 6 - Run prod D1 migrations

```bash
pnpm --filter @vc/web-next exec wrangler d1 migrations apply DB --remote --env production
```

Confirm all migrations applied successfully before deploying.

---

## Step 7 - Build and deploy to production

```bash
pnpm --filter @vc/web-next build
pnpm --filter @vc/web-next exec wrangler deploy --config dist/server/wrangler.json --env production
```

The deploy reads `env.production` from `wrangler.jsonc` (via the `configPath` reference in the
generated dist config) and applies production routes, vars, and bindings. The top-level dev
config is unaffected - `pnpm deploy:dev` continues to deploy without `--env`.

---

## Step 8 - Verify HTTPS and subdomains

Check the dashboard host:

```bash
curl -sI https://app.vibecms.dev/ | grep -E "HTTP|content-type|cf-ray"
```

Expected: `HTTP/2 200`, `content-type: text/html`.

Check a tenant blog subdomain (replace `<slug>` with a real site slug):

```bash
curl -sI https://<slug>.vibecms.dev/ | grep -E "HTTP|content-type|cf-ray"
```

Expected: `HTTP/2 200`, `content-type: text/html`.

Check SSL cert covers both:

```bash
echo | openssl s_client -connect app.vibecms.dev:443 -servername app.vibecms.dev 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
echo | openssl s_client -connect <slug>.vibecms.dev:443 -servername <slug>.vibecms.dev 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
```

Both should show `*.vibecms.dev` in the SAN list (free Universal SSL certificate).

---

## Step 9 - Enable zone-level CDN caching (recommended post-launch)

Public blog HTML is served with `cache-control: public, s-maxage=300` and
`cache-tag: vc-article:<siteId>:<postSlug>` headers. Cloudflare does not cache HTML by
default; enabling "Cache Everything" for blog paths cuts Worker invocations on high-traffic
sites and reduces Workers Paid usage costs.

In the Cloudflare dashboard for `vibecms.dev`:

1. Caching -> Cache Rules -> Create rule.
2. Scope: `Hostname equals *.vibecms.dev` OR `URI Path starts with /blog/`
3. Cache eligibility: **Cache Everything**
4. Respect origin TTL: enabled (honors the `s-maxage=300` from the Worker response)
5. Save and deploy.

The CLOUDFLARE_ZONE_ID + CACHE_PURGE_API_TOKEN secrets set in Step 3 enable the Worker to
purge by cache-tag on every publish, update, and archive action. Without those secrets the
Worker falls back to `caches.default.delete()` for path-mode URLs only.

---

## Step 10 - Smoke-test the full user flow

1. Create an account at `https://app.vibecms.dev` via email OTP.
2. Complete the onboarding setup (site slug, site name).
3. Create and publish a post.
4. Verify the post appears at `https://<slug>.vibecms.dev/<post-slug>` over HTTPS.
5. Archive the post - confirm it returns 404 (and, if CDN caching is enabled, that the
   previously cached page is no longer served within ~30 seconds via cache purge).
6. Test the Upgrade flow (billing button -> Polar checkout) once the Polar product is
   configured (Step 4).

---

## Quick reference: what each secret does

| Secret | Required | Purpose |
|--------|----------|---------|
| `TOKEN_PEPPER` | Yes | HMAC key for API token hashing |
| `BETTER_AUTH_SECRET` | Yes | Session signing key |
| `GOOGLE_CLIENT_ID` | No (OAuth optional) | Google sign-in |
| `GOOGLE_CLIENT_SECRET` | No (OAuth optional) | Google sign-in |
| `PLUNK_API_KEY` | Yes (prod) | Email OTP delivery |
| `POLAR_ACCESS_TOKEN` | Yes (billing) | Polar checkout + subscription API |
| `POLAR_WEBHOOK_SECRET` | Yes (billing) | Validates incoming Polar webhook events |
| `CLOUDFLARE_ZONE_ID` | Yes (caching) | Zone for cache-tag purge API |
| `CACHE_PURGE_API_TOKEN` | Yes (caching) | CF API token with Cache Purge permission |

Secrets gated on the pricing decision (Step 4):

| Secret | Purpose |
|--------|---------|
| `POLAR_PRODUCT_ID` | Monthly product fallback (or set as var in wrangler.jsonc) |
| `POLAR_MONTHLY_PRODUCT_ID` | Monthly subscription product |
| `POLAR_YEARLY_PRODUCT_ID` | Yearly subscription product |
