# VibeCMS-side spec: AutoSEOPilot native integration surface

Status: HANDOFF SPEC (docs only — written by the ASP side, 2026-07-04; execute
in this repo whenever its owner schedules it). ASP's adapter is being built
against the EXISTING /api/v1 in parallel with a manually-minted token, so
nothing here blocks ASP-side work; these three items unlock AUTO-provisioning
and clean slug lookup.

Context: ASP publishes articles into VibeCMS for its customers ("hosted blog
included with your plan"). ASP owns the billing relationship (customer never
sees a VibeCMS paywall). Full research mapping lives in the ASP repo:
docs/plans/2026-07-04-005-feat-cms-hardening-and-vibecms-integration-plan.md.

## 1. Provisioning endpoint (Large)

`POST /internal/provision`, authenticated by a shared-secret header
(`X-ASP-Provision-Secret` vs new env `ASP_PROVISION_SECRET`; constant-time
compare; 404 when env unset so the route is invisible unless configured).

Input: `{ customerEmail, siteName, siteSlug? }`.
Behavior:
- Create (or find) the user keyed by customerEmail — same identity the
  email-OTP login uses, so the customer can later "Manage your blog →" by
  signing in with that email (ASP decision #23 relies on this).
- Reuse ensureOnboarding internals (workspace_/site_ deterministic ids,
  membership, default domain) decoupled from a live session.
- Mark the site ENTITLED (item 2).
- Mint a full-preset `vc_live_` token via the existing insertKey path.
- Return `{ siteId, token, publicUrl }` (publicUrl from getSitePublicBaseUrl).
- Idempotent: repeat call for the same email returns the same site (and may
  rotate or re-return a token — pick one, document it).
- Companion: `POST /internal/revoke` (same auth) — flips entitlement off when
  the ASP subscription ends; content stays, site reverts to unpaid gates.

## 2. Entitlement without Polar (Medium)

A sponsored/entitled flag (or internally-set billing_status='active') that
must flow through ALL FOUR paid gates, else ASP-provisioned blogs are
broken in ways ASP customers will notice:
- isPublicBlogIndexable (server/public-blog-data.ts:128) — else noindex +
  no sitemap.
- FREE_PUBLISHED_LIMIT=1 publish cap (packages/core/src/commands/posts.ts:90).
- Asset-upload billing gate (server/api/operations.ts:222 + server/media.ts:52)
  — else zero images.
- Any other requireBillableSite call sites (grep before building).
Entitlement source of truth stays in VibeCMS's DB; ASP only toggles it via
the internal endpoints.

## 3. GET /api/v1/posts/by-slug/{slug} (Small)

findPostBySlug already exists (packages/core/src/commands/posts.ts:16,
repositories/posts.ts:280) — wire it to a GET route (posts:read scope),
returning the full post DTO or 404. ASP uses it for publish crash-recovery
(findExistingBySlug); the interim LIKE-search workaround over-matches.

## Non-goals (V1)
Outbound webhooks (ASP polls /activity), client-set publishedAt, categories.
