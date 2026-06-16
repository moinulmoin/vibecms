# Plan 008: Migrate frontend from RedwoodSDK to TanStack Start

> **Executor instructions**: Multi-phase migration. Each phase has its own acceptance gate; do not advance until the current phase is green. Work on branch `migrate-tanstack`. The existing rwsdk app at `apps/web` stays buildable and shippable on `dev` until the final cutover. Build/verify ONLY the app/phase you touch; Main runs repo-wide gates at integration points.

## Status

- **Priority**: P1 (founder decision; pre-launch)
- **Effort**: L (~2-3 focused weeks)
- **Risk**: MED-HIGH (full frontend rewrite; auth + form-pattern + render-strategy changes)
- **Depends on**: none (parallel to 007; supersedes 007 Part A if completed - free tier becomes viable)
- **Category**: architecture, cost, performance
- **Planned at**: commit on branch `migrate-tanstack`, 2026-06-15

## Why (decision record)

rwsdk 1.2.9 is SSR/RSC-only (source-verified): no prerender, SSG, ISR, or SPA mode. Consequences on Cloudflare Workers Free (10ms CPU): the per-user dashboard 1102s (needs Workers Paid), and public articles re-render per view. TanStack Start is render-flexible (SSR + prerender/SSG + ISR + SPA mode + selective SSR), an official Cloudflare target with static-prerendering support (Dec 2025). Founder chose to migrate BEFORE launch to unlock fully-free hosting + free self-hosting + render flexibility, accepting the rewrite cost. Astro+Hono (3-service split) and Next-on-CF (OpenNext adapter) were considered and rejected: TanStack Start gives the same free-tier outcome as one cohesive Cloudflare-native app.

## What ports vs what is rebuilt

- **Ports unchanged** (framework-agnostic): `@vc/core` (domain commands/policies), `@vc/db` (Drizzle schema + D1), `@vc/validators` (zod), `@vc/mcp` (tool catalog), `@vc/config` (constants), most of `@vc/ui` (React + Tailwind). `apps/web/src/server/*` is mostly Cloudflare/fetch-coupled (env, D1/R2, Better Auth, Polar) and ports with rewiring, not rewrite.
- **Rebuilt** (rwsdk-specific): `apps/web/src/worker.tsx` (defineApp/render/route), `Document`, the route middleware/ctx, and the native-HTML-form -> 303-redirect mutation pattern.

## Target architecture (render strategy = the whole point)

- **Public blog**: articles are DB-backed and published at runtime, so NOT pure build-time SSG. Use SSR + Cloudflare edge cache (`s-maxage` + Cache API) with Cache-Tag purge-on-publish (ISR-equivalent). Prerender only genuinely static pages (landing). Goal: ~0 worker CPU per article view after first render.
- **Dashboard** (`/app/*`): per-user -> SPA mode / `ssr:false` (static shell + client data via server functions). No per-request SSR -> runs on Workers Free.
- **Agent API**: TanStack Start server routes for `/mcp` (JSON-RPC, reuse `@vc/mcp`) and `/api/posts` (REST). Cheap JSON, free everywhere.
- **Auth**: Better Auth via TanStack server routes; port email-OTP + per-recipient rate-limit + CSRF guard + onboarding/ensure into the request pipeline.
- **Forms/mutations**: convert rwsdk POST-route+303 to TanStack server functions (or server routes returning redirects where no-JS resilience is wanted). Decide per form.

## Phases (each gated)

1. **Foundation**: scaffold `apps/web-next` (TanStack Start + @cloudflare/vite-plugin), wire `@vc/*` workspace deps + D1/R2 bindings, prove packages bundle. Gate: `pnpm --filter <web-next> build` green + local boot; `apps/web` still builds.
2. **Agent API**: port `/mcp` + `/api/posts` + bearer auth + quotas. Gate: MCP `tools/list`/`posts.create`/`posts.publish` + REST `GET /api/posts` work against dev D1.
3. **Auth**: Better Auth (session + email OTP) + OTP rate-limit + CSRF + onboarding/ctx. Gate: full OTP sign-in -> session -> onboarding.
4. **Public blog**: index + post + markdown variants; SSR+edge-cache + purge-on-publish; feeds/sitemap/robots/llms; media serve. Gate: published article renders, second view served from cache, edit purges.
5. **Dashboard**: shell + nav + 19 pages as SPA/selective-SSR; convert forms to server functions; port client islands (markdown editor, confirm-submit, copy). Gate: signup -> setup -> dashboard -> post create/publish/archive -> settings/token, no-1102 on free.
6. **Billing**: Polar checkout + portal + webhook. Gate: sandbox checkout -> active -> publish gating.
7. **Styling**: Tailwind + globals.css tokens + self-hosted fonts + the dark redesign components. Gate: visual parity light + dark.
8. **Verification & cutover**: full human + agent smoke on deployed dev (Workers Free, confirm no 1102); then swap `apps/web` -> the TanStack app, retire rwsdk, update wrangler/domain/docs.

## Risks / watch

- React duplication in the monorepo (align React 19 across apps; dedupe).
- TanStack `defaultSsr:false` cascades; per-route `ssr:true` under it is broken (May 2026) - keep public-blog SSR routes in a tree where SSR is enabled, dashboard in the SPA tree.
- Better Auth + TanStack server-route integration (cookies/session) - validate early in Phase 3.
- Form-pattern conversion is the largest surface (post CRUD, setup, media, billing, api-keys) - Phase 5 is the long pole.
- Cache-miss article render still costs CPU; fine after caching, but verify first-render under the free cap or prerender hot posts.

## Verification gate (per phase + final)

- Per phase: build the touched app green (`vite build && tsc --noEmit`) + the phase's behavioral smoke above.
- Final: deployed-dev smoke (human flow + 10 MCP tools + REST), confirm zero 1102 on Workers Free, light + dark UI, then cutover.

## Outcome

All eight phases completed. `dev.vibecms.dev` was cut over to TanStack Start on the `vibecms` worker. Live verification on that deployment included: real Plunk email OTP sign-in, authed owner export, public blog SSR (HTML and markdown), MCP with 10 tools, and dashboard use on Workers Free with no Error 1102. The legacy RedwoodSDK app at `apps/web` was deleted. Root tooling targets `@vc/web-next` only. `tokenHash` (HMAC-SHA256 + base64url with `TOKEN_PEPPER`) was preserved so existing API tokens remain valid.

**Deferred:** host-based public-blog subdomains (`/:slug` on `*.vibecms.dev` plus wildcard DNS), the subdomain half of plan 007. Path mode (`/blog/<siteSlug>/<postSlug>`) works today on dev.
