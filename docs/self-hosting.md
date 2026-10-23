# Self-host vibecms on Cloudflare

vibecms runs without Polar when `SELF_HOSTED=true`. Hosted billing gates and workspace API quotas are disabled, while media safety limits, scoped tokens, activity, and post versions remain active.

## Topology

Self-hosting uses the same Worker layout as vibecms Cloud, with the OG Worker optional:

1. **API + dashboard Worker**: Hono, Better Auth, REST, MCP, billing adapter, media writes, and the static TanStack Router SPA.
2. **Public Worker**: Astro SSR for blog pages, feeds, search, Markdown negotiation, and newsletter form forwarding.
3. **Optional OG Worker**: renders tenant share cards through a service binding. It has no public route.

The API and public Workers bind the same D1 database as `DB` and R2 bucket as `ASSETS_BUCKET`. The public Worker calls the API Worker through the `API` service binding. Public blog routes are host-based; the removed `/blog/<site-slug>/*` path mode is not supported.

Root `wrangler.jsonc` configures the API/dashboard Worker. Root `wrangler.public.jsonc` configures the Astro public Worker. Root `wrangler.og.jsonc` configures the optional OG Worker.

## Required resources

- Two Cloudflare Workers, plus an optional third OG Worker
- One D1 database, bound to both Workers as `DB`
- One R2 bucket, bound to both Workers as `ASSETS_BUCKET`
- One service binding named `API` from public to API
- Optional service binding named `OG` from public to the default `OgWorker` entrypoint. Remove this binding from `wrangler.public.jsonc` if you skip the OG Worker. Without it, generated `/og*.png` cards return 404; post covers and site default share images continue to work, and pages without either omit image metadata.
- A native `send_email` binding named `EMAIL` on the API Worker for real OTP delivery
- Images binding named `IMAGES` on the public Worker (already declared)
- Optional Analytics Engine dataset bound as `ANALYTICS` on the public Worker, plus `ANALYTICS_ACCOUNT_ID`, `ANALYTICS_DATASET`, and `ANALYTICS_API_TOKEN` vars on both Workers, for people + agent analytics. Without the binding trio, analytics collects nothing and the dashboard explains what to add; the Workers Free plan allows ~100,000 events/day.

Astro sessions are intentionally disabled in `apps/public/astro.config.mjs` (Better Auth owns app sessions). Self-host does **not** need a `SESSION` KV namespace unless you re-enable Astro sessions and add matching `kv_namespaces` ids in `wrangler.public.jsonc`.

The root `wrangler.jsonc` keeps three cron triggers on the API Worker: daily
`17 2 * * *` subpath re-check and media reconcile; `*/15 * * * *` media
recovery, managed-claim sweep (hosted only), and resumable analytics; and
`* * * * *` due scheduled publishing. Workers Free allows five cron triggers
per account; keep all three. Analytics requires Workers Paid's 1,000-query
invocation allowance for the budgets below.

Analytics commits each site's day (delete, inserts, state and continuation
cursor) atomically in one D1 batch. One day costs two D1 calls: the legacy
crawler read and the write batch, regardless of dimension count. A run first
reads entitled sites and rollup progress (two calls), processes oldest-unrolled
sites first, caps each site at seven dates, and reserves 21 calls for retention
compaction (one list plus at most 20 atomic site/month batches). Its counted
binding stops at 250 D1 calls. Migration 0043 adds durable per-site progress:
`next_source_date` resumes interrupted backfill without repeating the overlap,
and `refreshed_through` skips sites already refreshed through yesterday.
The normal three-date overlap is refreshed once per UTC day. Backfill retains
the existing source floor (today minus 89 days through yesterday: 89 closed
dates), so one fresh site takes 13 ticks rather than monopolizing one invocation.
After downtime only source-retained dates can be recovered.
Dashboard reads merge stored dates with the still-unrolled source suffix,
including the previous comparison period, so partial backfills do not hide
recent people/agent counts or count stored dates twice.

The frequent invocation's worst-case D1 total is **951**: claim sweep 500 +
analytics 250 + media 201. Media remains capped at 50 operations: one list +
50 × four calls (claim UPDATE, claimed-row SELECT, finish write, and a failure
marker if the finish fails). This leaves 49 calls of headroom; analytics no
longer shares the daily subpath invocation. No cron expressions change.
When the analytics budget defers sites, the informational structured event
`analytics_rollup_budget_exhausted` includes `queries`, `queryBudget`, and
`remainingSites`. Sites left by the seven-day cap also remain pending for the
next tick. Compaction resumes from the remaining daily rows.

Query comparison (excluding retention work, assuming V positive dimension rows
per day): the old implementation in this revision already chunked inserts into
batches of 75, so its actual cost was one site-state read plus
`D × (2 + ceil((V + 1) / 75))` for D dates, not V individual insert calls.
For V ≤ 74, one steady-state site cost 10 site-work calls; 100 cost 1,000;
one new site's 89 dates cost 268. The new implementation needs 6, 600, and
178 day-work calls respectively, plus three shared overhead calls per run
(entitled sites, progress, empty compaction list). Thus one steady site uses
9 calls; 100 drain in three ticks using 609 total; one new site drains in
13 ticks using 217 total. A conceptual 90-date backfill costs 180 day calls.
The old per-value model would instead cost `1 + D × (V + 3)` per site.

Replace the placeholder D1 IDs, bucket names, Worker names, service target, and host variables in the root Wrangler configs before deploying.

## Variables and secrets

API/dashboard Worker variables:

```txt
APP_ENV=production
APP_URL=https://vibecms.<your-subdomain>.workers.dev
BETTER_AUTH_URL=https://vibecms.<your-subdomain>.workers.dev
PUBLIC_BLOG_DOMAIN=vibecms-public.<your-subdomain>.workers.dev
SELF_HOSTED=true
EMAIL_FROM=vibecms <login@your-domain.com>
```

The public Worker uses the same `APP_URL`, `PUBLIC_BLOG_DOMAIN`, and `SELF_HOSTED=true` values. For analytics, give it the `ANALYTICS` dataset binding and set `ANALYTICS_ACCOUNT_ID`, `ANALYTICS_DATASET`, and `ANALYTICS_API_TOKEN` (the API token needs Analytics Engine read) on both Workers.

Set API Worker secrets from the repository root:

```sh
pnpm --filter @vc/api exec wrangler secret put BETTER_AUTH_SECRET --config ../../wrangler.jsonc
pnpm --filter @vc/api exec wrangler secret put TOKEN_PEPPER --config ../../wrangler.jsonc
```

Generate each secret with `openssl rand -hex 32`. Do not configure Polar secrets unless you intentionally want to exercise hosted billing.

## Sign-in email and optional OAuth

Enable Cloudflare Email Sending for your sender domain, keep the `EMAIL` binding in root `wrangler.jsonc`, and set `EMAIL_FROM` to an address on that domain:

```sh
pnpm --filter @vc/api exec wrangler email sending enable <your-domain> --config ../../wrangler.jsonc
```

Without the binding, self-hosted OTP codes are written to Worker logs for operator testing; that is not suitable for real users.

Google and GitHub sign-in are optional. Set both values for each provider you enable:

```sh
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_ID --config ../../wrangler.jsonc
pnpm --filter @vc/api exec wrangler secret put GOOGLE_CLIENT_SECRET --config ../../wrangler.jsonc
pnpm --filter @vc/api exec wrangler secret put GITHUB_CLIENT_ID --config ../../wrangler.jsonc
pnpm --filter @vc/api exec wrangler secret put GITHUB_CLIENT_SECRET --config ../../wrangler.jsonc
```

Use `<APP_URL>/api/auth/callback/google` and/or `<APP_URL>/api/auth/callback/github` as the authorized redirect URI for the providers you enable.

## Deploy

From the repository root:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build:self-host
pnpm deploy
```

`pnpm deploy` performs this order:

1. Build dashboard assets and all configured Workers.
2. Apply all D1 migrations through root `wrangler.jsonc`.
3. Deploy the API/dashboard Worker.
4. Deploy the optional OG Worker from `wrangler.og.jsonc`.
5. Deploy the Astro public Worker generated from `wrangler.public.jsonc`.

The API and OG Workers must deploy before public because its service bindings target them. If you skip OG, remove the OG build/deploy commands from the root scripts and the `OG` binding from `wrangler.public.jsonc`.

After deploy, open `APP_URL`, create the first account, and complete blog setup. Self-hosted onboarding skips Polar and lands on `/dashboard`.

Local migration commands:

```sh
pnpm db:migrate:self-host:local
pnpm db:migrate:self-host:remote
```

## MCP

Agents connect to the API Worker:

```txt
https://vibecms.<your-subdomain>.workers.dev/mcp
Authorization: Bearer vc_...
```

Create the scoped token under **Dashboard → Connect** and copy it once. The same REST/MCP permission and approval-first publishing rules apply in hosted and self-hosted modes.

## Deploy button readiness

Before exposing a public Deploy to Cloudflare button, rehearse the API/public flow and the optional OG Worker from a clean Cloudflare account. Verify D1/R2 provisioning, host variables, secrets, service bindings, migrations, and deployment order.
