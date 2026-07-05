# Plan 007: Resolve SSR Error 1102 (Workers Paid) and wire public blog subdomains

> **SUPERSEDED** by `docs/url-architecture-decision.md` (2026-07-05): multi-tenant path-mode (`/blog/<site-slug>/*`) is removed; public blogs are host-only (subdomain + custom domain). The dev path-mode URLs and `publicBlogUsesAppPath()` references below are historical. The Workers Paid (Part A) and prod wildcard subdomain work remain valid.

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report. Part A is a prerequisite for Part B and for any further human-facing dev/prod testing. When done, update the status row in `plans/README.md`.

## Status

- **Priority**: P0 (Part A, SSR is down) / P1 (Part B, subdomains)
- **Effort**: S (mostly Cloudflare account + config, little code)
- **Risk**: LOW
- **Depends on**: none (independent of 001-006)
- **Category**: launch infrastructure, cost, reliability
- **Planned at**: commit `00b9277` (branch `dev`), 2026-06-15

## Why this matters

The human signup -> publish dogfood on `dev.vibecms.dev` surfaced two launch-gating Cloudflare facts, both verified live:

1. **Error 1102 on every fresh React SSR render.** The worker exceeds its per-request CPU limit, so real visitors hitting any uncached page get a Cloudflare error page. This blocks the human dashboard (and therefore the human publish flow) entirely.
2. **Public blog subdomains are code-complete but not wired.** The `<slug>.<domain>` design (plan 002) works in code, but the Cloudflare wildcard DNS/route/certificate are not in place, and the free Universal SSL certificate only covers one subdomain level - which constrains the domain layout.

## Evidence / current state

### Error 1102 (CPU)

- Cloudflare Workers limits (docs, read 2026-06-15): **Free = 10 ms CPU/request; Paid = 30 s default (up to 5 min).** Memory (128 MB) and startup (1 s) are identical on both plans. Cloudflare states heavier workloads that "handle authentication, server-side rendering, or parse large payloads typically use **10-20 ms**" - above the free cap. Isolates get brief flexibility, then "execution will be terminated" on consistent over-limit.
- Repro on dev:
  - `fetch('/', {cache:'force-cache'})` -> 200 (edge cache masks it); `fetch('/?cb=...', {cache:'no-store'})` -> 503.
  - 12 concurrent fresh `no-store` requests across `/`, `/app`, `/app/posts`, post editor -> **12/12 = 503**.
  - Single light-page fresh request sometimes 200 (the per-isolate flexibility), heavy pages (editor) and any concurrency -> 1102 every time.
- Confirmed NOT a code bug and NOT startup/memory: the **agent JSON path works on free** (MCP `posts.list` -> HTTP 200, ~2 ms CPU, no React render; QA workspace already has API-published posts). Only React SSR exceeds the cap. Therefore the cause is strictly the **per-request CPU limit**, which only the Paid plan raises.

### Public blog URLs / SSL

- Code (verified): `apps/web/src/server/onboarding.ts` `defaultHostname(slug) = ${slug}.${PUBLIC_BLOG_DOMAIN}` writes a `domains` row (type `default`, status `active`) at signup/setup. `apps/web/src/server/public-blog.tsx` `resolveSite(request)` matches the request `Host` against `domains.hostname`. Path fallback routes `/blog/:siteSlug` and `/blog/:siteSlug/:postSlug` resolve by `sites.slug`. `apps/web/src/server/cms.ts` `publicBlogUsesAppPath()` returns true when `PUBLIC_BLOG_DOMAIN` host == `APP_URL` host (then dashboard shows the `/blog/<slug>` path URL), false otherwise (then it shows `https://<slug>.<domain>`).
- On dev, `PUBLIC_BLOG_DOMAIN == APP_URL == dev.vibecms.dev`, so dev is in **path mode**.
- `apps/web/wrangler.jsonc` route is an exact `{ "pattern": "dev.vibecms.dev", "custom_domain": true }` - no wildcard, so `<slug>.dev.vibecms.dev` does not reach the worker.
- Free **Universal SSL covers `vibecms.dev` and `*.vibecms.dev` (one level only)**. Nested `*.dev.vibecms.dev` is NOT covered and would require Advanced Certificate Manager (paid, ~$10/mo) or Total TLS. (Cloudflare SSL docs, 2026-06-15.)

## Part A - Resolve Error 1102 (P0, required first)

**Decision: upgrade the Cloudflare account to Workers Paid ($5/mo).** There is no free-tier path for dynamic React SSR; Cloudflare's own CPU numbers (10 ms free vs 10-20 ms typical SSR) make this structural, not tunable. Required for both dev and prod.

Steps:
1. (Operator, dashboard) **Workers & Pages -> Plans -> upgrade to Workers Paid.** Account-level; takes effect immediately, no redeploy strictly required.
2. (Optional, code) Leave the default 30 s CPU limit. Only if profiling later shows need, set in `apps/web/wrangler.jsonc`:
   ```jsonc
   "limits": { "cpu_ms": 30000 }
   ```
3. Re-run the dev deploy to confirm a clean state: `pnpm deploy:dev`.

Verification (all must pass):
- 6x sequential `fetch('https://dev.vibecms.dev/app/posts/<id>/edit?cb=...', {cache:'no-store'})` -> all 200.
- 12x concurrent fresh burst across `/`, `/app`, `/app/posts`, editor -> 0 x 503.
- Human publish flow end-to-end: log in (email OTP), open the draft editor (renders), click Publish -> post `status` becomes `published`, redirect `?ok=post_published`.

STOP if: after upgrade any SSR route still returns 1102 on a **single, non-concurrent** request. That would point to startup-time or memory (which Paid does not raise) - profile with DevTools CPU/memory before continuing.

## Part B - Public blog subdomains + SSL (P1, before promoting subdomain URLs at prod)

**Decision: single-level tenant subdomains `<slug>.vibecms.dev`, covered by free Universal SSL `*.vibecms.dev`. Do NOT nest under `dev.` Dev stays in path mode.**

Prod layout:
- App host: `app.vibecms.dev` (or apex `vibecms.dev`). Set prod `APP_URL` / `BETTER_AUTH_URL` to it.
- Blog base: `PUBLIC_BLOG_DOMAIN=vibecms.dev`. Because this differs from the app host, `publicBlogUsesAppPath()` is false -> dashboard shows `https://<slug>.vibecms.dev`.
- Wildcard DNS: add a **proxied `*.vibecms.dev`** record pointing at the prod worker.
- Wildcard route: add **`*.vibecms.dev/*`** to the prod worker's routes in `wrangler.jsonc` `env.production`. (A `custom_domain` entry cannot be a wildcard; use a route pattern.)
- SSL: free Universal SSL already covers `vibecms.dev` + `*.vibecms.dev`. **No ACM needed.**

Dev (now): keep path mode. After Part A, `https://dev.vibecms.dev/blog/<slug>` and `/blog/<slug>/<post-slug>` render (they are SSR, so they need Part A first). If real subdomains must be dogfooded on dev without paying for ACM, use single-level `<slug>-dev.vibecms.dev` (covered by `*.vibecms.dev`); otherwise path mode is simpler and free - recommended.

Verification:
- Path mode (dev, after Part A): publish a post, then `https://dev.vibecms.dev/blog/<slug>` renders the index and `/blog/<slug>/<post-slug>` renders the post.
- Subdomain mode (prod): `https://<slug>.vibecms.dev/<post-slug>` resolves over HTTPS with a valid cert and renders the post.

## Cost summary

- **Workers Paid: $5/mo** - required; the only fix for 1102 (dev + prod).
- **Tenant subdomains: $0 extra** - free Universal SSL, single level.
- **ACM ($10/mo): avoid** - only needed for nested `*.dev.vibecms.dev`, which the single-level layout makes unnecessary.

## Out of scope / optional follow-ups

- Edge-cache the landing page and public blog responses (Cache API / cache rules) to cut render count and cost even on Paid. Hygiene, not a blocker.
- SSR CPU profiling/optimization (DevTools) only if Paid still shows high CPU under load.
