# vibecms Feature Sheet

A complete, value-oriented inventory of what vibecms delivers. Grounded in the codebase, not marketing.

- `docs/FEATURES.md` = terse internal ledger of shipped/planned/skipped state.
- This file = the full customer + agent facing feature inventory, including small details.

Last updated: 2026-06-23

---

## The value proposition

**vibecms is the calm, markdown-native blog built for the human + agent era: hosted, own-your-domain, own-your-data, $19/month.**

Three things make it worth paying for:

1. **A genuinely nice blog, done for you.** Markdown-native (no block-editor bloat), 4 designed themes, full SEO/RSS/`llms.txt` hygiene, your own domain, fast managed hosting on Cloudflare.
2. **Your AI agent is a first-class operator.** A real MCP server (18 tools), a typed REST API (OpenAPI + live docs), a CLI, and scoped reveal-once tokens. An agent can run the whole blog safely.
3. **The trust boundary that avoids slop.** The platform never generates content; your agent is the intelligence, and the platform validates and nudges (`posts.format_guide`, `posts.preview`) while keeping an audit trail. You can export everything and walk away (no lock-in).

---

## Feature inventory

### Accounts and sign-in
- Passwordless email OTP (6-digit, 10-minute expiry); no passwords.
- OTP delivery via Cloudflare Email Sending when configured, console fallback otherwise.
- OTP send rate limit: 5 per hour per email (fail-open).
- Auto-provisioning on first sign-in: workspace + site + owner membership + default subdomain + billing row, in one step.
- Cross-origin POST guard on app and onboarding endpoints.
- Google OAuth wired but gated (off until credentials are set).

### Content and posts
- Markdown-native posts; status model draft to published to archived.
- Fields: title (160), slug (120, lowercase-hyphen, per-site unique), excerpt (500), content (500 KB), cover image, canonical URL (2048), SEO title (70), SEO description (180), up to 20 tags (40 chars each), presentation (layout + TOC).
- True-patch updates (omit a field to keep it; explicit null to clear).
- Atomic, idempotent publish; free tier caps at 1 published post (race-safe).
- Archive hides from public but keeps versions and activity.
- Auto-slug from title (stops once the slug is edited manually).

### Editor (dashboard authoring)
- Write/Preview toggle using the exact public renderer.
- Insert image from the media library at the cursor.
- Cover-image picker, SEO fields, tags, presentation panel (layout + TOC, constrained to the active theme).
- Unsaved-changes guard (in-app navigation + browser beforeunload).
- Inline validation; explicit manual save (no surprise autosave).

### Version history and audit
- Immutable snapshot on every create/update/publish/archive/restore, with the actor (human, token, or agent) and a change summary.
- List versions, view a full version, diff a version against current (line-level), restore.
- Restore is content-only: reverts all content/metadata/presentation, never silently re-publishes or changes dates.
- Full activity log of every meaningful action.

### Media
- Image upload (JPEG/PNG/WebP/GIF, up to 10 MB) to Cloudflare R2.
- Served at `/media-assets/<id>` with immutable 1-year cache.
- Alt text, list, delete; delete blocked (409) if the image is a post cover.
- 5 GB hosted storage on paid; live storage-usage meter.

### Themes and presentation
- 4 designed presets: `minimal` (default), `editorial`, `technical`, `product`; each token-driven, light/dark/system.
- 3 layouts: `standard`, `feature` (full-width hero cover), `essay` (prose measure + drop cap).
- Per-preset table-of-contents support; unsupported layout/TOC requests clamp gracefully (never error).
- Live theme preview in Settings with light/system/dark toggle.

### Rich content rendering (shared by editor preview and public blog)
- Sanitized pipeline, no raw HTML (XSS-safe by construction).
- GitHub callouts (`[!NOTE/TIP/IMPORTANT/WARNING/CAUTION]`), captioned images (`<figure>`), inline `[[toc]]` plus page-level TOC, fenced-code language labels, GFM tables/task lists, heading anchor slugs.
- External links hardened (`nofollow noopener noreferrer`); `safeHref` URL allow-listing.
- Non-blocking content warnings: unknown callout, TOC with no headings, long post without TOC, code fence missing a language, image missing alt text.

### Public blog (reader-facing)
- Host-only routing (tenant = host): each blog serves at the root of its own host — `/`, `/:post`, `/tag/:tag` — on `<slug>.vibecms.dev` subdomains and bring-your-own custom domains.
- Search across title/excerpt/body/tags (results are noindex + no-store).
- Tag listing pages; post cards with cover, date, excerpt, tag chips.
- Footer and end-of-post subscribe form (audience capture).
- Themed not-found page; apex falls back to the marketing landing.

### SEO and machine-readable output
- Per-post OG/Twitter/meta/canonical tags (cover image becomes OG image, brand fallback).
- RSS feed, sitemap.xml, robots.txt, all per-site.
- `llms.txt` (per-site index of clean-markdown post URLs, plus a product variant) and `content-signal` AI headers (`ai-train/search/ai-input`).
- Clean-markdown delivery of any post via `.md`, `?format=md`, or `Accept: text/markdown`, with YAML frontmatter (output only).
- `noindex` on unpaid blogs and on search pages.
- Favicons + PWA manifest + light/dark theme-color.

### Performance and caching
- Public responses carry `s-maxage=300` plus stale-while-revalidate.
- Per-article cache tags with automatic purge on publish/update/archive (Cloudflare zone purge, fail-open).

### Custom domains
- Bring-your-own domain per blog (owner + paid): add / list / remove in Settings.
- CNAME instruction plus live status badges (pending/active/failed) and verification errors.
- Hostname validation rejects the platform zone, IPs, wildcards, ports/paths.
- Race-safe reclaim of abandoned domains after 72 hours so a squatter cannot block the real owner.
- Cloudflare-for-SaaS provisioning + automatic SSL (activates at the production cutover).

### Agent and API surfaces (the differentiator)
- MCP server at `POST /mcp`, 18 tools: `sites.get`, `posts.list/search/get/create/update/publish/archive`, `posts.versions.list/get/restore`, `posts.format_guide`, `posts.preview`, `assets.upload/list/get/delete`, `activity.list`. JSON-RPC, 3 protocol versions, per-tool scope + read/destructive/idempotent hints.
- REST API `/api/v1`, 17 operations, plus public `GET /api/v1/openapi.json` (OpenAPI 3.1) and a Scalar docs UI at `/api/v1/docs`.
- CLI `@vibecms/cli` (`vibecms`): login, whoami, site, activity, schema introspection, posts (list/get/create/update/publish/archive), assets (list/get/upload/delete); `--json`/`--ndjson`/`--dry-run`; typed exit codes.
- Scoped bearer tokens `vc_live_...`: HMAC-hashed + peppered, reveal-once, 8 scopes, 3 presets (draft / publish=default / full), max 10 active, last-used tracking, owner-only management.
- `posts.preview` + `posts.format_guide` give agents theme-aware guidance before they write.

### Dashboard
- Overview (blog status, published/draft counts, media used, active tokens, API usage, recent posts/activity), Posts, Media, Activity, Settings, Connect, Billing, Setup.
- Connect-an-agent flow: one-click token, copy-paste MCP snippets for Claude Code, Codex CLI, Cursor, generic HTTP-MCP, and a stdio bridge, a live polling self-test, recovery states, and a starter prompt.
- Consistent inline success/error alerts via the `?ok=`/`?error=` pattern.

### Billing and plans
- Polar checkout (monthly + yearly) plus customer portal (owner-only); webhook flips subscription status.
- Free tier: drafting + agent tokens + 1 published (noindex) post.
- Paid unlocks: unlimited indexed publishing, media uploads, search indexing, custom domains.

### Quotas, security, and privacy
- API/MCP rate limits (per-minute/day/month, per-token), tiered free vs paid, with `X-RateLimit-*` headers.
- CSRF same-origin protection on dashboard mutations and media endpoints.
- Subscriber capture with explicit consent text + version, honeypot, rate limiting, and hashed IP/UA (privacy-preserving).

### Data ownership and self-hosting
- Owner-only full JSON export of every post (drafts/published/archived) at `/api/export.json`, no lock-in.
- Self-hosted mode: billing always active, no quotas, always indexable, running entirely on your own Cloudflare resources.

---

## Pricing

**vibecms Cloud: $19/month or $190/year** (annual is about 2 months free). Decided and wired across the whole product.

Plan includes: 1 hosted blog, unlimited posts, scoped MCP access, activity history, post version history, 5 GB media storage.

---

## What vibecms deliberately does not do (positioning, not gaps)

- No platform-authored AI content. The agent writes; the platform validates.
- No scheduled posts, no multi-blog/teams/comments, no block or page builder. Calm and markdown-native by design.
- Newsletter sending is captured-but-deferred (audience is collected today; delivery is a later track).
