# Agent Guide - vibecms

## Repo map

- `apps/api` - Hono Worker: REST `/api/v1`, MCP, auth, billing webhooks, the
  internal AutoSEOPilot routes, and it serves the dashboard build as assets.
- `apps/dashboard` - React + TanStack dashboard (the human control plane).
- `apps/public` - Astro Worker: landing, docs (`src/content/docs`), and every
  user's public blog.
- `apps/og` - OG image Worker.
- `packages/*` - `core` (domain logic), `db` (D1 repository + drizzle
  migrations), `content` (Markdown rendering), `api-contract` (schemas +
  OpenAPI), `mcp`, `validators`, `ui`, `cli` (`vibecms-cli`, on npm), `config`.
- `skills/` - the canonical agent skills, the only copy edited by hand; run
  `pnpm gen:agent-skills` after editing a skill.
- `plugins/vibecms` - Claude Code plugin (listed by `.claude-plugin/marketplace.json`).
  Plugin skills are generated from `skills/`; never edit them by hand.
  `server.json` is the MCP Registry entry; see `docs/directory-listings.md`.
- `docs/account-deletion.md` - operator runbook for safe hosted workspace/account
  deletion, external cleanup, billing retention, and backup/PITR handling.

## Working rules

- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm build`. Run `pnpm openapi:check`
  after API contract changes. CI runs these plus the test suite in parallel jobs.
- Dev: `pnpm deploy:dev` deploys the dev environment; check real behavior there.
- Prod deploys only from `main`, through the GitHub workflow:
  `gh workflow run deploy-production.yml --ref main -f release_sha=<full sha> -f smoke_mode=authenticated`.
- Never edit an existing migration in `packages/db/drizzle`; add a new one.
- Edit agent skills only in root `skills/<name>/`, then run `pnpm gen:agent-skills`.
  It regenerates `packages/config/src/agent/skills.generated.ts`, `skills-lock.json`
  and the plugin copies in `plugins/vibecms/skills/`; never edit those by hand.
- Never commit secrets. `.env*.local` files are gitignored; `pnpm public:audit`
  runs on every commit.
- Better Auth upgrades must re-audit installed core and `emailOTP` email-sending
  routes against `auth-guards.ts`: only budgeted sign-in OTP sends are enabled.
  Dashboard documents are asset-first; keep their security policy in
  `apps/dashboard/public/_headers`, not only Hono middleware.
- Sign in with vibecms (MCP OAuth, plan 029) mints agent-key grants: an
  `api_keys` row with `oauth_client_id`. Scope presets, quotas and revoke rules
  apply to keys and connections alike. `CIMD_TRUSTED_HOSTS` in
  `apps/api/src/server/oauth.ts` is a reviewed allowlist; never fetch client
  metadata from other hosts. The consent page `/authorize` stays asset-first.
- Keep docs current in the same change: the docs site
  (`apps/public/src/content/docs`), `docs/*.md`, and plan status in `plans/`.
  Update this file when a working rule changes. Delete docs that no longer
  match the product rather than leaving them stale.
- Public chrome uses explicit Tailwind sources: when adding shared layouts or page
  families, update `apps/public/src/styles/landing.css` sources. Keep tenant CSS
  independent. Smoke marketing/docs misses, legal styling and the collection-backed
  sitemap on local preview when remote deploys are outside scope.

## Testing

- Don't add tests by default. Write them when asked, or for the expensive
  areas below.
- Test observable behavior (input and output, what the user sees, what lands
  in the database or response), so a correct rewrite still passes. No tests
  that restate copy, constants, or which mock was called.
- A failing existing test is a past decision. Work out whether the code broke
  it or the intent changed. Never quietly loosen or rewrite it; ask if unsure.
- "Done" means typecheck, lint and build pass and you ran the real behavior
  (on dev or locally) and can show the result. A green suite alone is not proof.
- Remove noise tests you find (copy or constant mirrors, mock-call checks,
  tautologies, duplicates) and list them with reasons in the PR.

Expensive areas (keep and write behavior tests here):

- billing, entitlements and plan limits
- auth, sessions, CSRF, API keys and scopes
- the AutoSEOPilot internal API
- publishing and version pinning
- domain and hostname claims
- subscriber data and rate limits
- migrations
- escaping and sanitizing user content; secret and token leak checks

## Design Context

Before UI/design work in `apps/dashboard` or `apps/public`, read these two
source-of-truth files:

- **[PRODUCT.md](./PRODUCT.md)** - strategy: register, users, purpose, brand
  personality, anti-references, design principles, accessibility target.
- **[DESIGN.md](./DESIGN.md)** - visual system: OKLCH tokens, color, typography,
  components, layout, motion, the blog-template preset system.

### Non-negotiables

- **Register:** `brand` by default (the marketing landing). Override to
  `product` for dashboard surfaces (`/dashboard`, editor, settings, onboarding).
  The surface in focus decides.
- **Brand is locked.** Dark dev-tool / terminal identity. App fonts are fixed:
  Geist (display/body) and Geist Mono (mono). Do not swap fonts or drift
  maximalist - elevate within the identity.
- **Green is earned, never decorative.** `--brand-bright` only at ~8%: LIVE dots,
  active states, primary CTA, checkmarks, inline code/cursor, links. No large
  saturated green panels.
- **Not less, not more - just enough.** No gratuitous borders/dividers; cards
  only wrap genuinely interactive things; never nest cards.
- **Two token sets, don't cross them:** app/landing chrome uses `--*` /
  `--color-*`; user-facing blog templates use `--vc-*` (`presets.css`) so a
  user's blog looks like *their* brand, not vibecms.
- **Accessibility:** WCAG 2.1 AA. Body ≥4.5:1 (verify muted-fg on dark), visible
  focus rings, every animation reduced-motion safe.

These docs are maintained via the `/impeccable` skill (`init` / `document`).
