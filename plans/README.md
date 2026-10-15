# Implementation Plans

Plans are dated design records. Each describes the code as it was when it was
written — old file paths, package names (`apps/web`, `apps/web-next`), tool
counts, and prices inside plan bodies are historical, not current. Current
behavior lives in the code and in `docs/FEATURES.md` plus the docs site.

## Index

| Plan | Title | Status |
|---|---|---|
| 001 | [Add a launch smoke suite that covers the real contract](001-add-launch-smoke-suite.md) | DONE — coverage goal retired/superseded: the `test:smoke:launch` scripts no longer exist; coverage lives in the package worker/vitest suites and `scripts/production-smoke.ts` |
| 002 | [Make default public blog URLs real in hosted and self-host deployments](002-make-public-blog-urls-real.md) | DONE — superseded in part by `docs/url-architecture-decision.md` (host-only) |
| 003 | [Add CSRF protection to session-authenticated mutations](003-add-csrf-protection.md) | DONE — same-origin guards on Hono cookie-authenticated mutations (plan recipe obsolete) |
| 004 | [Make post mutations atomic with versions and activity](004-atomic-post-history.md) | DONE — publish pins an existing version; unpublished edits coalesce |
| 005 | [Harden MCP and REST contracts for agent-first launch](005-harden-mcp-and-rest-contract.md) | DONE — superseded by 009/021; REST is now a full contract (36 operations) |
| 006 | [Add workspace API and MCP quotas](006-add-workspace-api-quotas.md) | DONE — current tiers in `packages/config/src/index.ts` `API_USAGE_LIMITS` |
| 007 | [Resolve SSR Error 1102 (Workers Paid) and wire public blog subdomains](007-launch-infra-workers-paid-and-blog-subdomains.md) | REJECTED — superseded by 008 (TanStack migration made Workers Free viable); kept as incident/SSL history |
| 008 | [Migrate frontend from RedwoodSDK to TanStack Start](008-migrate-to-tanstack-start.md) | DONE — later superseded by 021 (Astro + Hono split) |
| 009 | [Expose one public API (OpenAPI 3.1) plus a CLI over the unified core](009-public-api-openapi-cli.md) | DONE — live OpenAPI at `/api/v1/openapi.json`, `vibecms-cli` ships |
| 010 | [Persist SEO fields (seoTitle / seoDescription) end-to-end](010-persist-seo-fields.md) | DONE |
| 011 | [Post version history: list / view / restore](011-post-version-history.md) | DONE |
| 012 | [Agent-first onboarding: connect, publish, see it live, then subscribe](012-agent-first-onboarding.md) | DONE — $19/$190 and one-free-post details in the body are historical |
| 015 | [Theme presets + per-preset agent guidance + audience capture](015-theme-presets-and-audience-capture.md) | DONE — initial four-theme/token-only starting point since extended by 018 and template structure |
| 016 | [Rich content components + agent content fidelity](016-rich-content-and-agent-fidelity.md) | DONE — the original no-raw-HTML boundary was later expanded to sanitized allowlisted HTML |
| 018 | [Theme presets v2: structural layouts + bounded per-post presentation](018-presets-v2-structural-layouts.md) | DONE — the reduced layout matrix in the body was later expanded (all presets support `wide` and ToC) |
| 019 | [Media asset parity (list / get / delete)](019-media-parity.md) | DONE — deletion now uses `assets:delete`; `coverAssetId` parity closed |
| 020 | [Public blog tag pages + search](020-public-blog-tags-search.md) | DONE — shipped; `basePath` abstraction live again for plan 022 customer subpaths |
| 021 | [Astro + Hono production split](021-astro-hono-production-split.md) | DONE — split implemented; production topology now includes the OG Worker and deploys OG → public → API |
| 022 | [Serve a blog at a path on the customer's own site (customer.com/blog)](022-blog-subpath-hosting.md) | DONE — shipped 2026-10-13 |
| 023 | [One analytics view for people and agents](023-human-and-agent-analytics.md) | DONE — shipped 2026-10-13 |
| 024 | [SEO checks: deterministic rules plus a cheap AI review](024-seo-checks.md) | DONE — shipped 2026-10-13, including the editor UI phase |
| 025 | [WebMCP: agents in the browser drive the dashboard](025-webmcp.md) | ON HOLD — owner decision 2026-10-13, not started |
| 026 | [Redirects, import, and IndexNow](026-redirects-import-indexnow.md) | ON HOLD — owner decision 2026-10-12, not started |

Status values: DONE | REJECTED (with one-line rationale) | ON HOLD. Plans 013,
014, and 017 have no plan files (numbers reserved/skipped).

Launch-hardening maintenance (2026-10-15): passwordless auth endpoint restrictions, dashboard document headers/noindex, registry-derived MCP write quotas, correlated exception causes, scheduled-publish failure activity/logs, and a pre-deploy D1 recovery timestamp in the deploy job summary are implemented. This does not close the open items below.

## Open

- **Self-host deploy button unrehearsed**: rehearse the clean-account
  Deploy-to-Cloudflare flow before promoting one-click deploy.
- **Public media is serveable by asset ID**: intentional until decided
  otherwise — if draft media must be private, write a plan before changing it.
