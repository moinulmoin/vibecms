# Production Launch Runbook

Ordered, copy-pasteable steps. Run from the repo root unless a directory is specified.
All `wrangler` commands run through pnpm to pick up the locally installed version.

Prereqs: Cloudflare account upgraded to Workers Paid ($5/mo), `wrangler login` authenticated.

---

## Step 1 - Create the prod D1 database

```bash
pnpm --filter @vc/api exec wrangler d1 create vibecms_prod
```

Copy the `database_id` from the output into both `apps/api/wrangler.jsonc` and `apps/public/wrangler.jsonc`:

```jsonc
// env.production -> d1_databases[0]
"database_id": "<paste id here>"
```

Commit that change before proceeding.

---

## Step 2 - Create the prod R2 bucket

```bash
pnpm --filter @vc/api exec wrangler r2 bucket create vibecms-assets-prod
```

No config change needed - the bucket name `vibecms-assets-prod` is already in `wrangler.jsonc env.production`.

---

## Step 3 - Set all required secrets

Run each command and paste the secret value when prompted.
All commands target `--env production` so they are stored against the prod environment only.

```bash
# Token pepper - generate: openssl rand -hex 32
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env production

# Better Auth secret - generate: openssl rand -hex 32
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env production

# Google OAuth (created at console.cloud.google.com - add https://app.vibecms.dev/api/auth/callback/google)
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_SECRET --env production

# OTP email uses the native `send_email` Workers binding (named EMAIL, declared in
# wrangler.jsonc) - no secret needed. Just ensure the sending domain is onboarded to
# Cloudflare Email Sending (verified in Step 8 / Step 10).

# Polar billing (see Step 4 below for POLAR_PRODUCT_ID - set access token + webhook secret now)
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
```

Cache purge secret (required to enable zone-level CDN cache invalidation on publish/archive).
The public `vibecms.dev` zone ID is committed in `apps/api/wrangler.jsonc`.

```bash
# CF API token with Cache Purge permission scoped to vibecms.dev
# Create at: dash.cloudflare.com/profile/api-tokens -> "Create Token" -> "Cache Purge" template
pnpm --filter @vc/api exec wrangler secret put CACHE_PURGE_API_TOKEN --env production
```

Analytics query secret (required for the paid Analytics dashboard):

```bash
# Create a custom read-only token restricted to this account and the vibecms.dev
# zone with Account Analytics: Read and Zone Analytics: Read. Do not use the
# broader "Read analytics and logs" template.
pnpm --filter @vc/api exec wrangler secret put ANALYTICS_API_TOKEN --env production
```

---

## Step 4 - Verify Polar prod products

1. Log into polar.sh -> your organization -> Products.
2. Confirm the committed monthly and yearly products remain active at $19/month and $190/year.
3. Confirm their IDs match `POLAR_PRODUCT_ID` and `POLAR_YEARLY_PRODUCT_ID` under
   `apps/api/wrangler.jsonc` -> `env.production.vars`.
4. Confirm the webhook endpoint is active:
   - URL: `https://app.vibecms.dev/api/polar/webhook`
   - Events: `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.revoked`
   - Copy the signing secret and set it if Step 3 did not:
     ```bash
     pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
     ```

---

## Step 5 - Configure wildcard DNS and the custom-domain fallback

Enable Cloudflare for SaaS on the `vibecms.dev` zone, create an API token with DNS Edit plus
SSL and Certificates Edit, then run:

```bash
CLOUDFLARE_ZONE_ID=<zone-id> CLOUDFLARE_API_TOKEN=<token> pnpm production:configure-hostnames
```

The idempotent command creates the proxied `*.vibecms.dev` tenant record, creates
`cname.vibecms.dev`, and sets that host as the Cloudflare for SaaS fallback origin.
The apex and `app.vibecms.dev` remain managed by their Worker custom-domain entries.

---

## Step 6 - Run prod D1 migrations

```bash
pnpm --filter @vc/api exec wrangler d1 migrations apply DB --remote --env production
```

This is an optional direct check; `pnpm deploy:prod` reruns the same migration before deploying.

---

## Step 7 - Build and deploy to production

Export the Cloudflare deployment credentials and a non-destructive bearer token for a production
site that already has at least one published post, then run the guarded deployment:

```bash
CLOUDFLARE_ACCOUNT_ID=<account-id> \
CLOUDFLARE_API_TOKEN=<deploy-token> \
PRODUCTION_SMOKE_TOKEN=<read-token> \
pnpm deploy:prod
```

`deploy:prod` runs the production preflight, migration, dashboard/API/public builds, both Worker
deployments, and a read-only smoke covering readiness, bearer authentication, tenant resolution,
and a rendered published article. Any failed stage stops the command.

For the first-ever production deployment only, no production account/token exists yet. Run with
`ALLOW_BOOTSTRAP_SMOKE=1` instead of `PRODUCTION_SMOKE_TOKEN`; the command reports that the
authenticated tenant checks were skipped. Create the first account and a non-destructive read token,
publish one post, then immediately run `PRODUCTION_SMOKE_TOKEN=<read-token> pnpm production:smoke`.
Every later deployment requires that token and runs the full tenant/article smoke.

---

## Step 8 - Verify HTTPS and hosts

Check the marketing apex:

```bash
curl -sI https://vibecms.dev/ | grep -E "HTTP|content-type|cf-ray"
```

Expected: `HTTP/2 200`, `content-type: text/html` (the marketing landing).

Check the app host root redirects to the dashboard:

```bash
curl -sI https://app.vibecms.dev/ | grep -E "HTTP|location"
```

Expected: `HTTP/2 308`, `location: https://app.vibecms.dev/dashboard` (the dashboard then redirects to `/login` when signed out). `https://app.vibecms.dev/dashboard` returns `HTTP/2 200` (the SPA shell).

Check a tenant blog subdomain (replace `<slug>` with a real site slug):

```bash
curl -sI https://<slug>.vibecms.dev/ | grep -E "HTTP|content-type|cf-ray"
```

Expected: `HTTP/2 200`, `content-type: text/html`.

Check SSL covers the apex, app host, and tenant subdomains:

```bash
echo | openssl s_client -connect vibecms.dev:443 -servername vibecms.dev 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
echo | openssl s_client -connect app.vibecms.dev:443 -servername app.vibecms.dev 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
echo | openssl s_client -connect <slug>.vibecms.dev:443 -servername <slug>.vibecms.dev 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
```

All should show `vibecms.dev` and/or `*.vibecms.dev` in the SAN list (free Universal SSL certificate).

---

## Step 9 - Enable zone-level CDN caching (recommended post-launch)

Public blog HTML is served with `cache-control: public, s-maxage=300` and
`cache-tag: vc-article:<siteId>:<postSlug>` headers, host-only (each blog on its own host —
`<slug>.vibecms.dev` or a custom domain). Cloudflare does not cache HTML by default; enabling
"Cache Everything" for blog hosts cuts Worker invocations on high-traffic sites and reduces
Workers Paid usage costs.

In the Cloudflare dashboard for `vibecms.dev`:

1. Caching -> Cache Rules -> Create rule.
2. Scope by **hostname** (there is no path-mode `/blog/*` to match): `Hostname equals *.vibecms.dev`
   for tenant subdomains. Custom domains (e.g. `blog.acme.com`, enabled in Step 11) are served on
   their own hostnames — add each custom-domain hostname to the rule (or use a broader
   `Hostname is not app.vibecms.dev and is not vibecms.dev` scope) once Cloudflare for SaaS is live.
3. Cache eligibility: **Cache Everything**
4. Respect origin TTL: enabled (honors the `s-maxage=300` from the Worker response)
5. Save and deploy.

The CLOUDFLARE_ZONE_ID + CACHE_PURGE_API_TOKEN secrets set in Step 3 enable the Worker to purge by
`cache-tag` on every publish, update, and archive action — the purge is tag-based, so it covers both
tenant subdomains and custom domains without per-URL rules. Without those secrets the Worker falls
back to `caches.default.delete()` against the article's host URL.

---

## Step 10 - Smoke-test the full user flow

1. Verify `https://vibecms.dev` serves the marketing landing, and `https://app.vibecms.dev/` redirects to the dashboard (then to `/login` when signed out).
2. Sign up at `https://app.vibecms.dev` via email OTP; confirm the OTP email arrives.
3. Complete the onboarding setup (site slug, site name); you land on `/dashboard`.
4. Create and publish a post.
5. Verify the post appears at `https://<slug>.vibecms.dev/<post-slug>` over HTTPS.
6. Archive the post - confirm it returns 404 (and, if CDN caching is enabled, that the
   previously cached page is no longer served within ~30 seconds via cache purge).
7. Test the Upgrade flow (billing button -> Polar checkout) once the Polar product is
   configured (Step 4).
8. Open a published post in a normal browser, wait for Analytics Engine ingestion, then confirm
   `/dashboard/analytics` reports the page view and loads its AI crawler panel without a query error.
9. Before inviting readers, publish a privacy disclosure covering the exact reader-analytics
   contract: post/site IDs and external referrer hostname, 90-day retention, no cookies/IP/user
   agents/visitor identifiers, and DNT + Global Privacy Control opt-out.

---

## Step 11 - Enable user custom domains (Cloudflare for SaaS)

Lets a paid blog serve on its own domain (e.g. `blog.acme.com`). All app code ships behind
this config: until the secrets below are set, "Add domain" stores a `pending` row and makes
no Cloudflare calls (so dev and an un-provisioned prod are both safe).

1. Enable Cloudflare for SaaS on the `vibecms.dev` zone (SSL/TLS -> Custom Hostnames).
2. Create a CF API token scoped to **SSL and Certificates: Edit** for `vibecms.dev`
   and store it on the API Worker:
   ```bash
   pnpm --filter @vc/api exec wrangler secret put CUSTOM_HOSTNAME_API_TOKEN --env production
   ```
3. Re-run the idempotent DNS/fallback command from Step 5 if it was not already run:
   ```bash
   CLOUDFLARE_ZONE_ID=<zone-id> CLOUDFLARE_API_TOKEN=<token> pnpm production:configure-hostnames
   ```
4. `CUSTOM_HOSTNAME_CNAME_TARGET=cname.vibecms.dev` is committed in the production Worker vars.
   When a customer creates a CNAME to that target, Cloudflare performs HTTP DV automatically.

Code shipped: hostname validation, the `domains` repository, owner/paid-gated commands with
stale-reclaim, the Cloudflare `custom_hostnames` client in `apps/api/src/server/custom-hostnames.ts`,
the Settings add/list/remove UI, and host-based Astro routes. Only `active` domains are served.

Verify after enabling (add a domain in the dashboard + create the CNAME first):
```bash
curl -sI https://blog.acme.com/ | grep -E "HTTP|cf-ray"
```
Expected once SSL is active: `HTTP/2 200`.

---

## Quick reference: production settings

| Setting | Required | Purpose |
|--------|----------|---------|
| `TOKEN_PEPPER` | Yes | HMAC key for API token hashing |
| `BETTER_AUTH_SECRET` | Yes | Session signing key |
| `GOOGLE_CLIENT_ID` | No (OAuth optional) | Google sign-in |
| `GOOGLE_CLIENT_SECRET` | No (OAuth optional) | Google sign-in |
| `POLAR_ACCESS_TOKEN` | Yes (billing) | Polar checkout + subscription API |
| `POLAR_WEBHOOK_SECRET` | Yes (billing) | Validates incoming Polar webhook events |
| `CLOUDFLARE_ZONE_ID` (var) | Yes (caching + analytics) | Committed `vibecms.dev` zone for cache purge and crawler queries |
| `CACHE_PURGE_API_TOKEN` | Yes (caching) | CF API token with Cache Purge permission |
| `ANALYTICS_API_TOKEN` | Yes (analytics) | Read-only Account Analytics + Zone Analytics queries |
| `CUSTOM_HOSTNAME_API_TOKEN` | Yes | CF token (SSL and Certificates: Edit) to provision custom hostnames |
| `CUSTOM_HOSTNAME_CNAME_TARGET` (var) | Yes (custom domains) | Committed CNAME target for customer DNS |

Secrets gated on the pricing decision (Step 4):

| Secret | Purpose |
|--------|---------|
| `POLAR_PRODUCT_ID` | Monthly product fallback (or set as var in wrangler.jsonc) |
| `POLAR_MONTHLY_PRODUCT_ID` | Monthly subscription product |
| `POLAR_YEARLY_PRODUCT_ID` | Yearly subscription product |
