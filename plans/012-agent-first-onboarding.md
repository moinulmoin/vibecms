# 012 - Agent-first onboarding: connect, publish, see it live, then subscribe

Status: DONE (shipped to dev worker version `5ba9967e`, 2026-06-19). Phases 1-5 implemented and gated green (`pnpm -r typecheck` + `lint` + `public:audit`). Verified on dev with a `pnpm dev:token` publish-preset e2e: create 201, publish 402 (free-cap hit, scope present), archive 403 (`Missing required scope: posts:archive`), public post 200 + `x-robots-tag: noindex`. The dashboard reveal UI is verified by code review + the validated server inputs (auth-gated, so not browser-driven here). The reprice to $19/$190 remains a SEPARATE, gated change.

## Goal
Re-sequence onboarding so the user watches THEIR OWN agent publish a real, live post via MCP before any paywall. The one free publish (FREE_PUBLISHED_LIMIT=1) becomes the activation moment; the plan ask comes after the live URL. Value-first conversion for the $19/$190 plan.

## Why (decision context)
VibeCMS is agent-native (MCP/REST/CLI); the differentiated "aha" is seeing your own agent publish to your own live blog, not a generic demo. Backed by oracle + market research (see local 012-discussion brief). The free-publish-one billing model makes "live URL before paywall" valid: the onboarding publish IS the free publish; subscribing then unlocks indexability, more publishes, media, and analytics.

## Current state (audited; apps/web-next)
- No `/signup`. Landing "Get started" -> `/login` (AuthForm: email-OTP or optional Google) -> hard redirect `/app` -> `/app` parent `beforeLoad` redirects to `/app/setup` until `siteSetupComplete`. `siteSetupComplete = Boolean(site.default_seo_title)`. [routes/login.tsx, components/AuthForm.tsx:39-60, routes/app/route.tsx:5-15, server/resolve-app-router-context.server.ts:21-40]
- `ensureOnboarding(user)` ALREADY auto-provisions workspace + site + default domain + billing row (status 'none') + `site.created` activity on first authenticated context resolve, before explicit setup. [server/onboarding.ts:39-91]
- `/app/setup` (SetupPage) collects name/slug/description only; `completeSiteSetupForApp` sets `default_seo_title` (the completion flag) + `default_seo_description`, updates the default domain hostname, then routes to `/app/connect?ok=setup_complete`. [SetupPage.tsx:34-121, dashboard-pages-fn.ts:21-30, onboarding.ts:134-180]
- `/app/connect` (ConnectPage): owner mints a DRAFT token (`createApiKeyMutation({preset:'draft'})`); one-time reveal is browser `sessionStorage` (`vc_token_flash`, consume-on-read) - NOT a cookie. ConnectAgent renders MCP snippets (Claude Code / Codex / Cursor / generic / mcp-remote) + a STARTER_PROMPT that drafts a welcome post and LEAVES IT AS A DRAFT (does not publish). [ConnectPage.tsx:21-112, lib/token-flash.ts:1-19, ConnectAgent.tsx:3-104]
- Token presets: `packages/core/src/types.ts` AGENT_TOKEN_PRESETS - `draft` (no publish/archive) and `full` (publish + archive). There is NO "publish but non-destructive" preset. Tokens minted in `server/api-keys.ts` (`vc_test_<rand>` + HMAC-SHA256 over TOKEN_PEPPER; owner-only; API_TOKENS_MAX cap). [api-keys.ts:79-176, core/types.ts:85-96]
- Billing: `/app/billing` + `/app/billing-required` -> `checkoutBillingMutation` -> `createCheckoutSessionForApp(monthly|yearly)` via Polar (monthly = POLAR_MONTHLY_PRODUCT_ID ?? POLAR_PRODUCT_ID; yearly = POLAR_YEARLY_PRODUCT_ID); success -> `/app?ok=billing_success`. PRICING in `packages/config` is currently `monthlyUsd 9, annualUsd 99` ('$9/month', '$99/year') - note this is ~1 month free, NOT the 2-months-free we want. [BillingPage.tsx, server/billing.ts:79-119, config/src/index.ts:87-93]
- Publish-detection signals already available: `getActivity` (action `post.published`), `getPosts` (status/publishedAt), `api_keys.last_used_at` (advances on bearer auth). [server/cms.ts:22-30, cms-dashboard.ts, post-mutations.ts:112-126]

## Proposed flow
0. (unchanged) `/login` email-OTP -> authed; `ensureOnboarding` still auto-creates the workspace/site.
1. NAME + BLOG-FROM-URL: at `/app/setup`, add an optional "existing website URL" field that PREFILLS blog name/slug/description (parse the hostname / light client-side prefill; NO scraping/import). Keep the slug pattern and manual-override.
2. CONNECT WITH A PUBLISH TOKEN: `/app/connect` mints a NEW non-destructive PUBLISH token (preset below), revealed once; pre-filled MCP command via the existing ConnectAgent snippets.
3. MCP SELF-TEST (new; oracle's #1 risk): before the publish prompt, verify the agent connected and can read context - poll `api_keys.last_used_at` advancing and/or a `sites.get`/`posts.list` having occurred - with clear recovery instructions on failure. Setup ambiguity must not be the first product experience.
4. PUBLISH PROMPT: update STARTER_PROMPT to WRITE AND PUBLISH the first post via MCP (today it leaves a draft).
5. DETECT + LIVE URL (new): poll `getActivity`/`getPosts` for the first `post.published`; on detection show the LIVE public URL with explicit framing: "Your first post is live (noindex). Upgrade to make it indexable, publish more, upload media, and see analytics."
6. PLAN: monthly/yearly checkout via the existing BillingPage path ($19/$190 after the reprice).
- CUT the conversational "does that make sense?" recap; replace with the direct upgrade CTA at step 5.
- SKIP/FALLBACK: the agent step is skippable; offer "write your first post manually" that still lands in the dashboard. Agent-publish is the happy path, not a hard gate.

## New token preset (non-destructive publish)
Add to `AGENT_TOKEN_PRESETS` (packages/core/src/types.ts) a preset with: `sites:read, posts:read, posts:create, posts:update, posts:publish, assets:write, activity:read` (EXCLUDES `posts:archive`). Wire it through `server/api-keys.ts` `parseScopes`/create path and make it the token ConnectPage mints during onboarding. Consider making it the new DEFAULT preset (product decision: per the pricing thread, "default is draft and publish, non-destructive").

## Scope (files)
- packages/core/src/types.ts (new preset), server/api-keys.ts (parseScopes + mint path), ConnectPage.tsx (mint with the new preset).
- SetupPage.tsx + dashboard-pages-fn.ts loadSetupPage/completeSetupMutation (optional URL prefill).
- ConnectPage.tsx + a new self-test + publish-watch sub-step; a server fn reporting connection + first-publish status (reuse getActivity/getPosts/last_used_at).
- ConnectAgent.tsx STARTER_PROMPT (write+publish).
- Upgrade CTA + copy (ConnectPage / config copy).
- (Reprice to $19/$190 is a SEPARATE change: config PRICING + Polar product IDs. Not in this plan, but the upgrade CTA copy should reflect the new value props.)

## Phases (each gated by manual verification on dev)
1. Non-destructive publish preset; ConnectPage mints it. Verify: the minted onboarding token publishes but CANNOT archive.
2. Setup URL prefill. Verify: a pasted URL prefills name/slug/description; manual edits still win.
3. Self-test + publish-detection server fn + polling UI. Verify: connecting an agent advances the self-test; publishing via MCP flips the step to "live".
4. Live-URL reveal + upgrade CTA; remove the recap. Verify: after the agent publishes, the live URL appears with the free->paid framing and checkout CTA.
5. Skippable manual fallback. Verify: skipping still reaches the dashboard with a "write first post" path.

## Acceptance / verification
- End-to-end on the dev worker, using `pnpm dev:token` to stand in for the user's agent: fresh workspace -> connect a publish token -> publish via MCP/REST -> onboarding detects it -> live URL + free->paid framing + checkout CTA.
- The onboarding token has publish but NOT archive (scope assertion).
- Skipping the agent step still lands in the dashboard.
- `pnpm -r typecheck`, `pnpm public:audit`, and the no-em-dash hook all green.

## Out of scope (v1)
- Website content import/scraping (prefill only).
- Newsletter send, analytics, custom domain (separate plans 013-016).
- Changing the auth method or adding a `/signup` route.
- Multiple tiers, trials, lifetime.
