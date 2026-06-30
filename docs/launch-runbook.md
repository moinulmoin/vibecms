# vibecms Cloud - production launch runbook

Promotes the hosted worker (`apps/web/wrangler.jsonc`, worker name `vibecms`) from
the current dev/sandbox state to production. Self-hosting has its own path in
[`self-hosting.md`](./self-hosting.md) and is unaffected.

Each step is copy-paste. Replace every `<...>` placeholder. All `wrangler` commands
run from the repo root and target the worker in `apps/web/wrangler.jsonc` via the
`@vc/web` filter. Secrets are stored by Cloudflare (`wrangler secret put`); vars live
in `apps/web/wrangler.jsonc`.

> Heads up: `pnpm deploy:prod` is the production deploy used here (it applies D1
> migrations to the remote DB bound as `DB`, builds, and runs `wrangler deploy --config dist/server/wrangler.json`). It is
> deliberately self-contained, not an alias of `deploy:dev`, because after this first
> release `deploy:dev` becomes the dev-branch deploy - keeping them independent avoids
> a prod deploy silently shipping to dev later.

## Prerequisites

- `wrangler login` done, on the Cloudflare account that will own production.
- A domain already added to that Cloudflare account (zone active).
- Cloudflare Email Sending enabled on your Cloudflare account, with your sending domain onboarded (for OTP email).
- A **production** [Polar](https://polar.sh) organization - production and sandbox are
  fully isolated (separate org, token, products, webhook secret), so the sandbox org
  used for testing cannot be reused.

---

## 0. Decide resources and data

The current worker uses D1 `vibecms_dev` and R2 `vibecms-assets`, which hold test/dogfood
data. Pick one:

### Option A (recommended): fresh production resources

Clean data, isolated from anything you tested with.

```bash
# create prod D1 + R2
pnpm --filter @vc/web exec wrangler d1 create vibecms-prod
pnpm --filter @vc/web exec wrangler r2 bucket create vibecms-assets-prod
```

Then edit `apps/web/wrangler.jsonc`:

- `d1_databases[0].database_name` -> `vibecms-prod`
- `d1_databases[0].database_id` -> the id printed by `d1 create`
- `r2_buckets[0].bucket_name` -> `vibecms-assets-prod`

Keep the bindings named `DB` and `ASSETS_BUCKET` (the code depends on them).

### Option B: reuse the existing worker, purge test data

Faster, but production keeps the `vibecms_dev` DB name and you must clear test rows:

```bash
pnpm --filter @vc/web exec wrangler d1 execute DB --remote --command \
  "DELETE FROM activity_events; DELETE FROM post_versions; DELETE FROM posts; DELETE FROM assets; DELETE FROM api_keys; DELETE FROM usage_counters; DELETE FROM rate_limits; DELETE FROM domains; DELETE FROM billing_customers; DELETE FROM memberships; DELETE FROM sites; DELETE FROM workspaces; DELETE FROM session; DELETE FROM account; DELETE FROM verification; DELETE FROM \"user\";"
```

---

## 1. Rotate production secrets

Never reuse the dev `BETTER_AUTH_SECRET` / `TOKEN_PEPPER`.

```bash
# generate two fresh values
openssl rand -hex 32   # -> BETTER_AUTH_SECRET
openssl rand -hex 32   # -> TOKEN_PEPPER

pnpm --filter @vc/web exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @vc/web exec wrangler secret put TOKEN_PEPPER
```

> Rotating `TOKEN_PEPPER` invalidates every previously issued agent API token. That is
> the intent for a clean launch; agents re-mint tokens after go-live.

---

## 2. Email delivery (Cloudflare Email Sending) - required for real OTP

Without `CLOUDFLARE_EMAIL_API_TOKEN` the worker only logs codes to `wrangler tail`
(sign-in is impossible in production).

1. Enable **Email Sending** on the Cloudflare account and onboard your sending domain
   (add the SPF/DKIM/DMARC records Cloudflare provides).
2. Create a Cloudflare API token with **Email Sending** permission.
3. Set the secret and a sender var:

```bash
pnpm --filter @vc/web exec wrangler secret put CLOUDFLARE_EMAIL_API_TOKEN
```

Add to `apps/web/wrangler.jsonc` `vars` (not sensitive):

```jsonc
"EMAIL_FROM": "vibecms <login@<your-domain>>"
```

The `EMAIL_FROM` address must be on the domain you onboarded to Cloudflare Email Sending. `CLOUDFLARE_ACCOUNT_ID` is already set as a var in `apps/web/wrangler.jsonc`.

---

## 3. Polar billing (production)

In your **production** Polar organization (`https://polar.sh/dashboard/<org_slug>`):

1. **Products** -> create two recurring products: a monthly and a yearly plan. Copy each
   product id.
2. **Settings -> General -> Developers** -> create an Organization Access Token. Copy it.
3. **Settings -> Webhooks -> Add Endpoint**:
   - URL: `https://<your-domain>/polar/webhook`
   - Generate (or set) a signing secret and copy it.
   - Subscribe to: `checkout.updated` and all `subscription.*` events
     (these are the only events the worker acts on - see `billing.ts`).

Set the secrets:

```bash
pnpm --filter @vc/web exec wrangler secret put POLAR_ACCESS_TOKEN
pnpm --filter @vc/web exec wrangler secret put POLAR_WEBHOOK_SECRET
```

Update `apps/web/wrangler.jsonc` `vars`:

```jsonc
"POLAR_SERVER": "production",
"POLAR_MONTHLY_PRODUCT_ID": "<monthly_product_id>",
"POLAR_YEARLY_PRODUCT_ID": "<yearly_product_id>"
```

Remove the old `"POLAR_PRODUCT_ID": "product_dev_placeholder"` line (the monthly id
replaces it; the code falls back to `POLAR_PRODUCT_ID` only if `POLAR_MONTHLY_PRODUCT_ID`
is unset).

> The webhook is what flips a workspace to `active` (status updates only happen via
> `/polar/webhook`, never the checkout success redirect). If `POLAR_WEBHOOK_SECRET` is
> unset while `APP_ENV=production`, the webhook endpoint returns 500 by design.

---

## 4. (Optional) Google sign-in

Skip to leave email-only sign-in (the button hides itself when unset).

1. Google Cloud Console -> OAuth client (Web application).
2. Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`
3. Set both (the button only appears when both exist):

```bash
pnpm --filter @vc/web exec wrangler secret put GOOGLE_CLIENT_ID
pnpm --filter @vc/web exec wrangler secret put GOOGLE_CLIENT_SECRET
```

---

## 5. Custom domain and DNS

Simplest topology (recommended): app and public blogs share one hostname, blogs served
at `/blog/<slug>`. This avoids wildcard DNS.

1. Add the custom domain to the worker. In `apps/web/wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "<your-domain>", "custom_domain": true }
],
"workers_dev": false
```

   (Or add it via the dashboard: Workers & Pages -> `vibecms` -> Settings -> Domains & Routes
   -> Add Custom Domain. Cloudflare creates the proxied DNS record automatically.)

2. Point the three URL vars in `apps/web/wrangler.jsonc` `vars` at it:

```jsonc
"APP_URL": "https://<your-domain>",
"BETTER_AUTH_URL": "https://<your-domain>",
"PUBLIC_BLOG_DOMAIN": "<your-domain>"
```

   With `PUBLIC_BLOG_DOMAIN` equal to the app host, blogs render at
   `https://<your-domain>/blog/<site-slug>`.

> Per-blog subdomains (`<slug>.blog.<your-domain>`) and host-based public blogs on
> `*.vibecms.dev` are deferred follow-ups. Start with the path-based layout unless you
> specifically need subdomains.

---

## 6. Flip to production

In `apps/web/wrangler.jsonc` `vars`:

```jsonc
"APP_ENV": "production"
```

This turns on the real API usage tiers / `429` enforcement and the production Polar
webhook-secret requirement. Confirm `"SELF_HOSTED": "false"` is still set.

Leave `API_USAGE_TEST_LIMIT` unset in production (it is a dev-only override for forcing a
small quota).

---

## 7. Deploy

```bash
pnpm typecheck
pnpm deploy:prod   # applies D1 migrations to the remote DB, builds, deploys the worker
```

If you created a fresh D1 in step 0, the migration apply also creates the schema on it.

---

## 8. Verify on the real domain

Run the same checks the dev dogfood covered, now against `https://<your-domain>`:

- [ ] **OTP email actually arrives** (the one thing dev could not prove): request a code,
      confirm it lands in a real inbox, sign in. Watch `wrangler tail` if it does not.
- [ ] **Signup -> setup -> connect -> dashboard** loads; dashboard pages render in light
      and dark mode.
- [ ] **Publish gating**: first post publishes free; a second returns "subscribe to
      publish more"; subscribing (Polar production checkout with a real card) flips the
      workspace to `active` via `/polar/webhook`; check D1
      `billing_customers.status = 'active'`.
- [ ] **Paid surfaces** unlock after subscribing: publish more than one post, media upload,
      and the public blog becomes search-indexable (no `noindex`).
- [ ] **Agent path**: `claude mcp add --transport http vibecms https://<your-domain>/mcp
      --header "Authorization: Bearer <token>"`, then exercise a couple of tools.
- [ ] **Real rate limits** (only active when `APP_ENV=production`): exceed the free API
      tier on `/api/posts` and confirm `429 {"error":"RATE_LIMIT"}`; send >5 OTP codes to
      one email within an hour and confirm the 6th is blocked.
- [ ] **Public blog**: a published (paid) post renders with correct title/OG/canonical,
      cover image, and markdown; `/blog/<slug>/llms.txt` and `.md` are reachable.
- [ ] **Lighthouse** on the public blog and dashboard: LCP / CLS / INP in the green.

## Rollback

- Vars/domain: revert the `apps/web/wrangler.jsonc` changes and `pnpm deploy:prod`.
- Secrets: re-`put` the previous value, or `wrangler secret delete <NAME>`.
- D1 migrations are additive; there is no auto-downgrade. Restore from a D1 export
  (`wrangler d1 export`) taken before launch if needed.