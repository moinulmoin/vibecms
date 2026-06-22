# VibeCMS Feature Ledger

Living record of what is shipped, in progress, planned, and intentionally skipped.
Update this whenever a feature is added, removed, or planned.

- `CHANGELOG.md` = code release notes (per-commit/version).
- This file = product/feature state and roadmap.

Last updated: 2026-06-22

---

## Shipped

### Auth & accounts
- Passwordless email OTP sign-in (Better Auth `emailOTP`, 6-digit, 10-min expiry).
- OTP delivery via Plunk when `PLUNK_API_KEY` is set; otherwise console-logged (local/test).
- OTP send rate limit: 5/hour per email (D1, fail-open).
- Auto-provisioning on first sign-in: workspace + site + owner membership + default domain + billing row (`none`).

### Content / posts
- Markdown-native posts; status model `draft | published | archived`.
- Create / update (true patch) / publish / archive; publish is atomic + idempotent.
- Fields: title, slug, excerpt, contentMarkdown (<=500 KB), coverAssetId, seoTitle, seoDescription, tags (<=20), presentation (layout/TOC).
- Per-site unique slugs; slug conflict surfaced as `slug_conflict`.

### Version history
- Immutable snapshot on every create/update/publish/archive/restore.
- List versions, view a version, restore (content-only; does not change status/publishedAt).

### Editor (dashboard)
- Write/Preview toggle using the exact public renderer.
- Image insert from the media library; cover-image selector; SEO + tags fields.
- Presentation panel (layout + TOC, constrained to the active theme preset).
- Unsaved-changes guard; version-history sheet (view/restore).

### Media
- Image upload (jpeg/png/webp/gif, <=10 MB) to R2, served at `/media-assets/<id>` (immutable cache).
- List / delete; delete blocked (409) when the asset is a post cover.
- Hosted storage quota: 5 GB (paid).

### Themes & presentation
- 4 curated presets: `minimal` (default), `editorial`, `technical`, `product` (token-driven, light/dark).
- 3 layouts: `standard`, `feature`, `essay`; per-preset TOC support; unsupported requests clamped, never error.

### Rich content rendering
- Sanitized unified pipeline (no raw HTML): GitHub callouts, captioned images, `[[toc]]` + page TOC, fenced-code language labels, heading slugs.
- External-link `rel` hardening + `safeHref` URL allow-listing.
- Content validation warnings (unknown callout, TOC without headings, long post without TOC, missing code language, missing alt).

### Public blog
- Path-based (fully wired): `/blog/:siteSlug` index+search, `/blog/:siteSlug/:postSlug`, `/blog/:siteSlug/tag/:tag`.
- Host-based index/tag wired via host resolution; the apex falls back to the marketing landing.
- Body search (LIKE over title/excerpt/content/tags); search results are `noindex` + `no-store`.
- Clean-Markdown delivery of any post (`.md` / `Accept: text/markdown` / `?format=md`) with YAML frontmatter (output only).

### Public output & SEO
- RSS feed, sitemap.xml, robots.txt, llms.txt (per-site + product variant), `content-signal` AI headers.
- Per-post OG/meta/canonical; `noindex` for unpaid/trial blogs.
- Public caching (`s-maxage=300` + per-article cache tag) with publish/update/archive purge.

### Agent surfaces
- MCP server at `POST /mcp` with 18 tools (sites/posts/assets/activity/versions + `posts.format_guide` + `posts.preview`).
- REST API `/api/v1` (17 operations) + public `GET /api/v1/openapi.json` and Scalar docs at `/api/v1/docs`.
- CLI `@vibecms/cli` (login/whoami/site/posts/assets/schema).
- Bearer tokens `vc_live_...` (HMAC-hashed, peppered, reveal-once); 8 scopes; 3 presets (draft / publish=default / full); max 10 active tokens.

### Dashboard
- Overview, Posts, Media, Activity, Settings, Connect, Billing, Setup.
- Connect-an-agent flow with MCP config snippets (Claude Code, Codex CLI, Cursor, generic HTTP-MCP, stdio) + a polling connection self-test + starter prompt.
- Inline alerts via 303 `?ok=`/`?error=`.

### Onboarding
- Setup (name/slug/description) with "from a website" prefill of name+slug only (no scraping/import).

### Billing (hosted)
- Polar checkout + customer portal (owner-only); webhook flips subscription status.
- Free tier: drafting + agent tokens + 1 published post (noindex); subscription unlocks more publishes, media, and search indexing.

### Quotas, security, export
- API/MCP quota counters (hosted); CSRF on server functions + selected POSTs; subscriber capture with consent + IP/UA hashing.
- Owner-only full JSON export of all posts (`GET /api/export.json`).
- Self-hosted mode (`SELF_HOSTED=true`): billing always active, no quotas, always indexable.

---

## In progress

- **Agent cover images**: expose `coverAssetId` as a typed field on the create/update API (MCP + REST). Agents already upload via `assets.upload`; this lets them set/clear the post cover (the OG image + feature-layout hero), matching what the dashboard already does. [2026-06-22]
- **Canonical URL write path**: add `canonicalUrl` as a typed create/update field (API + MCP + dashboard editor); persist to posts + version snapshots. Column + export already exist. [2026-06-22]

---

## Planned

- **Custom domains for users** (bring-your-own domain per blog). Foundation exists: `domains` table with `type=custom` + `cloudflare_custom_hostname_id` + `verification_errors_json`, and host-based resolution. Still needed: Cloudflare custom-hostname provisioning + DNS verification UI + the root host-based post route (currently latent). Wanted feature.
- **Google OAuth sign-in**: code is wired in `auth.ts`, gated behind `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Coming soon (enable once the OAuth client is provisioned).
- **Diff view in version history**: compare a version against current (or version-vs-version) in the editor's history sheet. (Note: the landing copy says "diff" - building this makes that claim true.)
- **Newsletter delivery** (separate track, currently ON HOLD): audience capture stores pending subscribers today; double opt-in confirmation + sends (Plunk) are deferred. Not a gap in the current scope.

---

## Skipped / out of scope

- **Scheduled posts**: intentionally skipped. (DB retains a harmless legacy `scheduled` status that is normalized to `draft`; no scheduling workflow.)
- **Multi-blog / teams / comments**: single-blog-per-workspace by design.
- **Page builders / block editor**: Markdown-native by design ("calm blog").
- **Platform-authored AI content**: the agent is the intelligence; the platform validates/nudges (e.g. `posts.format_guide`, `posts.preview`) but never writes content.

---

## How to maintain this

- When you ship something, move it from Planned/In progress to Shipped with the date.
- When you decide not to do something, record it under Skipped with a one-line reason.
- Keep entries terse; this is a ledger, not documentation. Deep docs live elsewhere in `docs/`.
