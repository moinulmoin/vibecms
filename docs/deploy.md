# Deploy vibecms Cloud

Hosted vibecms uses three Cloudflare Workers with separate failure domains:

- `vibecms-api-dev` / `vibecms-prod`: Hono APIs, Better Auth, MCP, billing/webhooks, media writes, and static dashboard SPA assets.
- `vibecms-og-dev` / `vibecms-og-prod`: internal share-card renderer (Takumi WASM and fonts), bound to public as `OG`.
- `vibecms-public-dev` / `vibecms-public-prod`: Astro SSR for public blogs, feeds, search, media reads, and newsletter form forwarding.

The API and public Workers share D1/R2. The public Worker has service bindings named `API` and `OG` targeting the API and OG Workers.

## Configuration ownership

Keep hosted configuration in source control:

- `apps/api/wrangler.jsonc`
- `apps/public/wrangler.jsonc`
- `apps/og/wrangler.jsonc`

Wrangler named environments do not inherit vars or most bindings. Production blocks therefore repeat D1, R2, routes, service/email/version bindings, and all production vars. Secrets remain in Cloudflare and are not committed.

Do not edit routes, bindings, or vars only in the Cloudflare dashboard; the next Wrangler deploy replaces them with source configuration.

## Local development

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

The dashboard Vite server proxies same-origin API routes to the local Hono Worker. Wrangler's local service registry connects the Astro public Worker to the API Worker.

## Verification gates

Push work to `dev` to run CI before staging and promotion. CI also runs on
`main` pushes and pull requests; it runs typecheck, lint, build, tests, and
`pnpm check`. The latter checks OpenAPI and generated agent-skill freshness,
the public release audit, append-only migration history, CLI changesets for
CLI and compiled workspace runtime dependency changes, feature counts, and
skill directory listings. Locally, it compares against the merge base with
`origin/main` by default; set `CHECK_BASE` to a committed comparison base
when needed. CI uses the previous push commit or the PR's base branch. An
unresolved base fails the check. The production-dependency audit also runs
daily and can be run manually.

`pnpm deploy:prod` runs these inside `production:preflight` before any D1 mutation:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm public:audit
pnpm openapi:check
```

Preflight then builds production artifacts (dashboard, API and OG production dry-runs, public with `CLOUDFLARE_ENV=production`). A standalone `pnpm build` remains available for local verification and uses the development API dry-run env.

## Development and staging deploy

Commit your changes on `dev` and push them to run CI:

```sh
git push origin dev
pnpm deploy:dev
```

Use the staging environment to check the deployed behavior. Deploy from a
clean checkout of the pushed commit: after the deploy succeeds,
`deploy:dev` records that commit in the staging tag. A dirty checkout cannot
be reliably identified with a commit; the command warns and removes the
remote staging tag instead. Commit and push the changes, then redeploy before
promoting.

Order is fixed:

1. Sync the development `TOKEN_PEPPER`.
2. Apply D1 migrations to the development database.
3. Build dashboard assets.
4. Deploy `vibecms-api-dev`.
5. Deploy `vibecms-og-dev`.
6. Build and deploy `vibecms-public-dev`.

## Promotion and production deploy

Once the pushed `dev` commit has passed CI and has been deployed and checked
in staging, promote it:

```sh
pnpm promote
pnpm promote --deploy  # alternatively, promote and deploy to production
```

Choose one command, not both. Promotion requires a clean `dev` checkout at
`origin/dev`, a successful CI run and matching staging tag for that commit,
and `main` to be its ancestor. It advances protected `main` without a force
push; never force-push `main`. `--deploy` also starts and watches the
production workflow for that exact commit. `pnpm release:status` reports
release status.

The Changesets release workflow opens or updates a version PR when needed.
Merge that version PR with admin bypass of branch protection; the bypass is
for versioning, not a substitute for green CI or the normal promotion path.
After merging it, reconcile from `dev` with
`git fetch origin && git merge origin/main && git push origin dev`, wait for
CI, and redeploy staging before the next promotion.

The production workflow checks the full reviewed commit SHA is on `main` and
has a successful CI `verify` check before running `pnpm deploy:prod`
(`scripts/deploy-prod.mjs`). After a successful deploy it updates the
production tag. The normal `--deploy` path uses authenticated smoke and
requires the `PRODUCTION_SMOKE_TOKEN` production environment secret.

`pnpm deploy:prod` is also the break-glass fallback when GitHub Actions is
unavailable: run it only from a clean checkout of the reviewed `main`
commit, using an existing `wrangler login` OAuth session for backup,
migrations, and Worker deploys. The workflow's `PRODUCTION_SMOKE_TOKEN`
environment secret must be supplied locally for authenticated smoke:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> CLOUDFLARE_PREFLIGHT_API_TOKEN=<read-only-token> PRODUCTION_SMOKE_TOKEN=<read-token> pnpm deploy:prod
```

Keep the verification token in `CLOUDFLARE_PREFLIGHT_API_TOKEN`; setting a
read-only token as `CLOUDFLARE_API_TOKEN` overrides OAuth and blocks
production writes. The workflow instead uses a deployment-capable
`CLOUDFLARE_API_TOKEN` for the full command.

Order is fixed and owned by `pnpm deploy:prod`:

1. `wrangler whoami` login refresh, then `production:preflight` — validate typecheck/lint/tests/public audit/OpenAPI, confirm required D1/R2/Images/Analytics/Email/custom-hostname resources and secret names, then build all production artifacts (dashboard, API and OG dry-runs, public with `CLOUDFLARE_ENV=production`) before any D1 mutation.
2. `production:backup` — capture D1 time-travel bookmark/schema-export metadata and current API/public Worker deployment version IDs (non-destructive).
3. Rebuild the dashboard and the public site (`CLOUDFLARE_ENV=production`) and assert the public build targets `vibecms-public-prod`/`vibecms_prod`.
4. If migration `0018_post_published_version` is still pending, confirm the write freeze and plan the one-time pin step (see RELEASING.md). Routine deploys skip this.
5. Apply D1 migrations to production; abort if any remain pending.
6. Deploy `vibecms-og-prod`, then `vibecms-public-prod`.
7. First cutover only: pin each live post's published version while the old API still serves.
8. Deploy `vibecms-prod` (API), verify every published post has a pinned version, then run `production:smoke` — authenticated via `PRODUCTION_SMOKE_TOKEN`.

## First deploy only

One-time provisioning for a fresh hosted stack. Routine deploys skip all of
this.

Create the shared data resources:

```sh
pnpm --filter @vc/api exec wrangler d1 create vibecms_prod
pnpm --filter @vc/api exec wrangler r2 bucket create vibecms-assets-prod
```

Put the resulting D1 id and bucket name in `env.production` of both
`apps/api/wrangler.jsonc` and `apps/public/wrangler.jsonc`; both Workers must
point at the same database and bucket.

A brand-new database has no tables. The deploy preflight requires existing
`user`, `posts`, and `post_versions` tables, so apply migrations once before
the first guarded deploy:

```sh
pnpm --filter @vc/api exec wrangler d1 migrations apply DB --remote --env production
```

Wildcard DNS and the custom-domain fallback origin need Cloudflare for SaaS
enabled on the `vibecms.dev` zone plus an API token with DNS Edit and SSL and
Certificates Edit:

```sh
CLOUDFLARE_ZONE_ID=<zone-id> CLOUDFLARE_API_TOKEN=<token> pnpm production:configure-hostnames
```

The idempotent command creates the proxied `*.vibecms.dev` tenant record,
creates `cname.vibecms.dev`, and sets that host as the Cloudflare for SaaS
fallback origin. `CUSTOM_HOSTNAME_CNAME_TARGET=cname.vibecms.dev` is
committed in the production Worker vars; when a customer CNAMEs to that
target, Cloudflare performs HTTP DV automatically.

The production API environment declares a native `EMAIL` send-email binding.
Enable Cloudflare Email Sending for `vibecms.dev`, publish the supplied
SPF/DKIM/DMARC records, and keep `EMAIL_FROM` on the onboarded domain:

```sh
pnpm --filter @vc/api exec wrangler email sending enable vibecms.dev --env production
```

Production treats a missing hosted email binding as an error; it never logs
OTPs as a fallback.

Set the Polar product ids and `POLAR_SERVER=production` in the API production
vars, and point Polar's webhook at
`https://app.vibecms.dev/api/polar/webhook` with a signing secret matching
`POLAR_WEBHOOK_SECRET`.

Bootstrap smoke (no tenant token yet): deploy with `ALLOW_BOOTSTRAP_SMOKE=1`
and `PRODUCTION_BOOTSTRAP_SHA=$(git rev-parse HEAD)` instead of
`PRODUCTION_SMOKE_TOKEN`. Preflight rejects bootstrap unless that full
reviewed SHA matches the checkout. Immediately remove the SHA after the
deploy, create a site + read token + one published post, and run
`PRODUCTION_SMOKE_TOKEN=<token> pnpm production:smoke`. Require the token on
every later deploy.

## Polar webhook signing-secret rotation

Deploy the dual-format verifier **before** resetting either secret. This runbook
requires the founder's approval for each environment; preparing the patch does
not authorize a deploy or secret change. Do not paste secrets or signature
headers into tickets, chat, logs, shell arguments, or source control.

### Why both encodings are necessary

[Polar's delivery documentation](https://polar.sh/docs/integrate/webhooks/delivery)
dates the signing-key change to **8 September 2026, 00:00 UTC**:

- Older secrets sign with the UTF-8 bytes of the **entire** secret, including
  `whsec_` when present. Standard Webhooks libraries need that full string
  base64-encoded first.
- New secrets use Standard Webhooks: pass the dashboard secret as-is; the
  library strips `whsec_` and base64-decodes the suffix.
- Both generations can start with `whsec_`; the prefix is not a reliable
  generation detector. The verifier tries as-is first for that prefix, then
  the legacy encoding (reverse order otherwise). Both go through the same
  SDK inbound schemas after verification, including camelCase/date conversion.

The installed SDK 0.47.1 `src/webhooks.ts:140-144` always base64-encodes the
UTF-8 string, verifies it, then parses its inbound schema. That accepts the
legacy key only, not a new Standard Webhooks key. `standardwebhooks` 1.0.0
`dist/index.js:25-45` implements raw keys or prefix-stripped base64 keys;
`:47-72` verifies signatures, and `:89-101` enforces a five-minute tolerance.
No tolerance or receipt/order behavior changes in our adapter.

Polar documents native support from SDK `1.0.0-alpha.19`. The latest stable
checked on 2026-10-23, `1.0.2` (published 2026-10-02), clears the 24-hour package
release-age rule, but removes the existing `/webhooks` and `/lib/http.js`
exports and changes the SDK API. Keep 0.47.1 for this focused fix; migrate the
client separately rather than couple secret rotation to a breaking upgrade.

### Sandbox first: `vibecms-api-dev`

1. Obtain approval, run the verification gates above plus `pnpm build`, then
   deploy the reviewed verifier to development using the normal development
   procedure. Record its Worker version and the previous version for rollback.
   Confirm the existing sandbox endpoint still delivers successfully.
2. Use a dedicated dev QA workspace and Polar **sandbox** endpoint
   `https://app.basedui.dev/api/polar/webhook`. Record the workspace ID and
   current billing status/watermark using a read-only D1 query (below).
   Confirm the endpoint is enabled and subscribed to the existing billing events.
3. Keep the previous secret in an approved password manager only if it is
   needed for rollback; do not copy it into an agent transcript. Reset the
   sandbox endpoint secret in Polar. In the Cloudflare dashboard, update only
   `POLAR_WEBHOOK_SECRET` for **`vibecms-api-dev`** to the exact newly issued
   string and deploy that secret update. Do not base64-encode it yourself.
   Minimize this mismatch window; deliveries during it may fail and need replay.
4. Complete a fresh sandbox subscription/checkout for the QA workspace to
   produce a newer `subscription.active` / succeeded `checkout.updated` event.
   In Polar's delivery view require **HTTP 200**, not merely an enabled endpoint.
   Query the dev D1 database and require the matching receipt plus the updated
   billing status, customer/subscription ID, and event watermark. A dashboard
   "send test" event without this workspace metadata is not billing proof.

   ```sql
   SELECT workspace_id, status, polar_customer_id, polar_subscription_id,
          current_period_end, webhook_event_id, webhook_updated_at
   FROM billing_customers WHERE workspace_id = '<qa-workspace-id>';
   SELECT event_id, event_type, source_timestamp, applied_status
   FROM polar_webhook_receipts WHERE workspace_id = '<qa-workspace-id>'
   ORDER BY created_at DESC LIMIT 5;
   ```

5. Redeliver the same sandbox event. Require 200, one receipt for its event ID,
   and unchanged billing watermarks. Redeliver failures from the rotation window
   through Polar so they receive a fresh signed delivery timestamp; do not replay
   captured HTTP bytes (the timestamp expires). Retain delivery IDs, response
   codes, Worker version, and redacted before/after row evidence, never secrets
   or signature values. Check that the endpoint has not auto-disabled.

### Production, only after sandbox evidence and approval

1. Promote/deploy the reviewed patch through the production workflow above;
   confirm existing production deliveries still return 200. Record old/new
   Worker versions and securely preserve the old secret if rollback requires it.
2. Reset the **production** Polar endpoint secret for
   `https://app.vibecms.dev/api/polar/webhook`; update and deploy only
   `POLAR_WEBHOOK_SECRET` on **`vibecms-prod`**, not the public or dev Worker.
   Keep sandbox and production credentials isolated.
3. Observe an authorized real production billing event: require Polar HTTP 200,
   the matching receipt and the correct billing row/watermark using read-only
   queries above. Do not create charges or alter customer subscriptions just
   for verification without explicit approval. Until such an event exists,
   report production billing verification as pending, not complete.
4. Redeliver any rotation-window failures in Polar and monitor deliveries and
   billing state. Polar documents ten retries and automatic disabling after
   ten consecutive failed deliveries; investigate failures before re-enabling.
   Delete the superseded secret from temporary secure storage after acceptance.

### Recovery / rollback

- A secret mismatch: keep the dual-format code deployed and correct the Worker
  secret to the endpoint's **current** value, then redeliver failures in Polar.
  This is safer than reverting working code. Reset again if the new value was
  lost; never expose it while troubleshooting.
- Before rotation, code may roll back to the recorded old Worker version while
  the legacy secret still matches. After rotation, **do not roll back to the
  old legacy-only verifier** while Standard Webhooks signing is active.
- If a paired secret rollback is necessary and Polar allows restoring the exact
  old endpoint secret, restore it on both Polar and the API Worker, then replay
  failures. Do not assume Polar can restore a generated secret; if it cannot,
  keep/redeploy the dual-format patch and set the new matching secret instead.
  Worker-version rollback alone is not a secret rollback; explicitly confirm
  both bindings and endpoint configuration.
- Do not roll back D1 or delete receipts: failed authentication writes nothing,
  and successful redeliveries must retain idempotency and ordering protection.

## Post-deploy smoke checklist

`pnpm deploy:prod` already runs `production:smoke` (infrastructure always;
authenticated tenant/article checks when `PRODUCTION_SMOKE_TOKEN` is set).
Verify the broader checklist once per launch and after any cross-system
change:

1. `GET https://app.vibecms.dev/api/health/live` returns 200 and a Worker version id.
2. `GET https://app.vibecms.dev/api/health/ready` returns 200.
3. `https://vibecms.dev` serves the marketing landing; `https://app.vibecms.dev/` redirects to the dashboard; `https://<slug>.vibecms.dev/` serves a tenant blog.
4. Complete email OTP sign-in and first-site onboarding.
5. Create a scoped token; run one MCP read and one approval-first draft/publish flow.
6. Open the published post on its public host and confirm HTML, feed, sitemap, robots, `llms.txt`, and `Accept: text/markdown` behavior.
7. Upload a valid image; reject an invalid image payload; verify the public media response is immutable and `nosniff`.
8. Complete Polar checkout and portal flows; replay a webhook id and verify it does not apply twice.
9. Confirm API logs correlate failures with `X-Request-ID` and contain no authorization, cookie, token, OTP, or request-body values.
10. Add and verify one real custom domain, then confirm HTML, Markdown, canonical metadata, media, and removal on that host.
11. Run the managed AutoSEOPilot lifecycle with production credentials: provision, status read, bearer REST/MCP use, generation rotation, revoke, denied reuse, and preserved customer content.

## Secrets

Set hosted API Worker secrets against an explicit named environment
(`development` selects `vibecms-api-dev`, `production` selects
`vibecms-prod`). Do not combine `--env` with `--name`: Wrangler treats
`--name` as a base and appends the selected environment.

Development:

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env development
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env development
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env development
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env development
```

Production:

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --env production
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_ACCESS_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put POLAR_WEBHOOK_SECRET --env production
pnpm --filter @vc/api exec wrangler secret put CACHE_PURGE_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put ANALYTICS_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put CUSTOM_HOSTNAME_API_TOKEN --env production
pnpm --filter @vc/api exec wrangler secret put AUTOSEOPILOT_INTERNAL_SECRET --env production
```

Generate `BETTER_AUTH_SECRET` and `TOKEN_PEPPER` independently with
`openssl rand -hex 32`; rotating `TOKEN_PEPPER` invalidates every issued
agent token. The three Cloudflare API tokens are narrowly scoped to their
jobs:

- `CACHE_PURGE_API_TOKEN`: purge cache for the production zone.
- `ANALYTICS_API_TOKEN`: read the configured Analytics Engine dataset.
- `CUSTOM_HOSTNAME_API_TOKEN`: create, inspect, and remove Cloudflare for
  SaaS custom hostnames (SSL and Certificates: Edit).

`AUTOSEOPILOT_INTERNAL_SECRET` is optional; it only enables the managed
`/internal/autoseopilot` routes and must be a separate high-entropy value
shared only with the AutoSEOPilot service.

Google and GitHub OAuth secrets are optional. Configure both the client ID and client secret for each provider you enable. OTP delivery uses the native `EMAIL` send-email binding and `EMAIL_FROM` var.

## Health and rollback

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- API logs include `X-Request-ID`; unexpected app, REST and MCP exceptions emit one `unhandled_exception` event with redacted message, stack and bounded causes. Client error responses do not expose those details.
- Scheduled publishing emits `scheduled_publish_failed` with post/site IDs and an error code for terminal failures, `scheduled_publish_retry` for retryable failures, and `scheduled_publish_run` counts (`attempted`, `published`, `failed`, plus retries and abandoned leases) on every tick, including empty runs and lease-bookkeeping failures. Terminal failures also create owner-visible `post.schedule_failed` activity.
- Dashboard static assets use `apps/dashboard/public/_headers`, copied to `apps/dashboard/dist/_headers`, for CSP, frame denial, nosniff, referrer policy, HSTS and noindex. The `/*` rule covers `/login` and deep dashboard SPA fallbacks in hosted and self-hosted builds; Worker-generated responses still use middleware.
- The API liveness response includes Worker version metadata.

Executable helpers (safe defaults are non-destructive):

```sh
pnpm production:backup
pnpm production:rollback
pnpm production:rollback -- --worker api --to <version-id> --yes
pnpm production:rollback -- --worker public --to <version-id> --yes
```

`production:rollback` with no flags only prints backup metadata, current API/public Worker deployments, and D1 time-travel info. Worker rollback does not undo D1 writes. D1 migrations are forward-only; time-travel restore is destructive and requires explicit confirmation flags (`--d1-restore --i-understand-d1-restore-is-destructive --yes`). Do not treat that as a safe schema rollback.

### Recovery point

The repository is public, so `deploy-production.yml` never uploads backup
files as artifacts. Before deploying, it writes the pre-deploy UTC timestamp to
the run's job summary. D1 Time Travel can restore to any timestamp in the last
30 days, so that timestamp is the recovery point:

```sh
pnpm production:rollback -- --d1-restore --timestamp <recovery-point> --i-understand-d1-restore-is-destructive --yes
```

Only run it after accepting that the restore is destructive. Worker versions
roll back with `--worker api|public --to <version-id> --yes`; list version IDs
with `wrangler versions list`.

## Deploy-button rehearsal

Before exposing the self-host Deploy to Cloudflare button, rehearse the flow
from a clean Cloudflare account and browser path:

- Cloudflare uses the repo root and the `pnpm deploy` build/deploy command.
- D1 binds as `DB`; R2 binds as `ASSETS_BUCKET`; migrations in
  `packages/db/drizzle` run successfully.
- `BETTER_AUTH_SECRET` and `TOKEN_PEPPER` are provided before deploy.
- `APP_URL`, `BETTER_AUTH_URL`, and `PUBLIC_BLOG_DOMAIN` are changed from
  placeholders to the actual Worker hostnames.
- First signup lands in setup, then `/dashboard` — not `/dashboard/billing`.
- The API Worker, optional OG Worker, and public Worker deploy in order and
  the `API`/`OG` service bindings resolve.

If any production or development secret ever touched git history, chat logs,
screenshots, or CI logs, rotate it before launch: `BETTER_AUTH_SECRET`,
`TOKEN_PEPPER`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, and every
Cloudflare API token.
