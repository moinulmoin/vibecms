# vibecms Feature Ledger

Living record of what is shipped, in progress, planned, and intentionally skipped.
Update this whenever a feature is added, removed, or planned.

- `CHANGELOG.md` = code release notes (per-commit/version).
- This file = product/feature state and roadmap.

Last updated: 2026-10-28

---

## Shipped

### Auth & accounts
- Passwordless email OTP sign-in (Better Auth `emailOTP`, 6-digit, 10-min expiry).
- OTP delivery via Cloudflare's native `send_email` Workers binding (`EMAIL`, declared in wrangler.jsonc) on an onboarded sending domain; otherwise console-logged (local/test).
- OTP send rate limit: 5/hour per email (D1, fail-closed when the durable budget cannot be checked).
- Only sign-in OTP sends are enabled and budgeted; unused email-verification, password, account-deletion and email-change send endpoints return 404.
- Auto-provisioning on first sign-in: workspace + site + owner membership + default domain + billing row (`none`).
- Sign in with vibecms (plan 029): agent apps that support MCP sign-in (Claude on web, desktop and phone; Claude Code) connect with only the MCP URL. OAuth 2.1 authorization code + S256 PKCE, discovery (RFC 9728/8414), Client ID Metadata Documents from trusted hosts (claude.ai, chatgpt.com) and public-client DCR. Apps are asked for up to Manage; the owner picks one blog and one access level on a consent screen (Write and publish preselected, Write drafts or an explicit Manage choice; levels the app didn't ask for are disabled). The connection is an agent-key record, so scopes, quotas, activity and Disconnect work exactly like keys. Access tokens (`vc_oat_`, 1 hour, MCP only) and rotating refresh tokens (30 days, reuse ends the connection; revoking one disconnects the app) are stored as peppered digests. Expired and abandoned OAuth records are cleaned every 15 minutes.

### Content / posts
- Markdown-native posts; status model `draft | published | archived`.
- Create / update (true patch) / publish / archive; publish is atomic + idempotent. Agents archive; people can permanently delete archived posts in the dashboard, including their versions and history.
- Fields: title (≤160), slug (≤120, lowercase-hyphen), excerpt (≤500), contentMarkdown (≤500,000 characters), coverAssetId (≤120), canonicalUrl (≤2048), seoTitle (≤70), seoDescription (≤180), tags (≤20 of ≤40 chars), presentation (layout/TOC).
- Update patch semantics: omit a field to keep it; `null` clears cover/canonical and resets presentation; title/body/tags reject `null`; excerpt/SEO strings clear with an empty string.
- Per-site unique slugs; slug conflict surfaced as `slug_conflict`; auto-slug from title until the slug is edited manually.
- Scheduled publishing: `posts.schedule` / `posts.unschedule` (+ REST + dashboard) pin an approved version for a future `publishAt`. Scheduling preserves the current draft/published status — a draft stays private, and a published post keeps serving its current live version until the scheduled run.
- Scheduled publication retries transient errors up to three attempts; permanent errors fail immediately. Terminal failures appear in Activity and the posts list; structured failure events and per-run counts include crashed final attempts.
- Original publish date for imports: `posts.publish` accepts `originalPublishedAt` on a post's first publish (from 1990, in the past). The blog shows that date, orders by it and uses it in JSON-LD, the Markdown twin and RSS `pubDate`; `publishedAt` stays the real vibecms publish time and no false "Updated" line appears.

### Version history
- Meaningful changes create versions with the actor (human, token, or agent) and a change summary; publish pins the approved existing version (no new row), eligible unpublished draft edits fold into the tip (renumbered), and no-op saves do not create a version. Live and scheduled versions are protected from folding.
- List versions, view a version, diff a version against current, restore (reverts all content fields incl cover/canonical; does not change status/publishedAt).

### Editor (dashboard)
- Markdown remains canonical. CodeMirror 6 provides the Markdown surface; BlockNote provides the visual surface only when its adapter can round-trip the document safely (trailing-newline / trailing-space normalization outside code fences is allowed).
- Views: Write, Split (desktop), Preview, and a conditional Review view when a human decision is pending (agent draft or unpublished changes to a live post). Settings live in a separate rail.
- Slash commands, search/history, direct image upload and media-library insert; cover-image selector; SEO + tags fields.
- Presentation panel (layout + TOC, constrained to the active theme preset).
- Exact-version autosave/concurrency checks, unsaved-changes guard, and version-history sheet (view / diff vs current / restore).

### Media
- Image upload (jpeg/png/webp/gif, <=10 MB) to R2, served at `/media-assets/<id>` (immutable 1-year cache).
- Alt text, list / delete; delete blocked (409) when the asset is a post cover or site social image, and agent deletion requires the dedicated `assets:delete` scope.
- Media inspector alt-text drafts are protected on dismissal and navigation; confirmed discard returns focus to the image tile.
- Hosted storage quota: 10 GB (paid) with a live usage meter; free tier includes 10 images.

### Themes & presentation
- 4 curated presets (`minimal` default, `editorial`, `technical`, `product`; display labels Minimal/Editorial/Notebook/Magazine), token-driven, light/dark/system.
- Template structure per preset: chrome (masthead/centered/sidebar), index (list/grid/compact), article header (plain/centered/card); owners can override each.
- 4 layouts: `standard`, `essay`, `feature`, `wide`; every preset supports every layout and the page-level TOC. Unsupported requests clamped, never error.
- Dedicated Theme workspace: preset, mode, accent, typography, structure knobs, live public-site preview.

### Rich content rendering
- Sanitized unified pipeline: allowlisted raw HTML via `rehype-raw` + `rehype-sanitize` (dangerous markup/attributes removed, DOM-clobbering guards on generated ids), GitHub callouts, captioned images, `[[toc]]` + page TOC, fenced-code language labels, GFM tables/task lists, heading slugs.
- External-link `rel` hardening + `safeHref` URL allow-listing.
- Content validation warnings (unknown callout, TOC without headings, long post without TOC, missing code language, missing alt).

### Public blog
- Host-based routing (tenant = host): index+search at `/`, posts at `/:postSlug`, tags at `/tag/:tag`, served on `<slug>.vibecms.dev` subdomains and bring-your-own custom domains. The platform apex falls back to the marketing landing.
- Customer subpath hosting (plan 022): a paid site can set its primary location to `customer.com/blog`, served through the customer's own proxy/worker to `/_vc/p/<id>` ingress; location get/set/check/remove via REST and MCP `sites.location.*`. Tenant identity stays host-based.
- Body search (LIKE over title/excerpt/content/tags); search results are `noindex` + `no-store`.
- Clean-Markdown delivery of any post (`.md` / `Accept: text/markdown` / `?format=md`) with YAML frontmatter (output only).
- Footer and end-of-post subscribe form (audience capture); themed not-found page.
- Old-link redirects: owners' agents add exact path redirects (`redirects.list/set/delete`, Manage access; free 20, paid 5,000 per blog). They answer only would-be 404s with a 301 after real pages and slug redirects, respect subpath base paths, and can't claim system routes or form chains. Tenant 404s are `no-store` so new redirects apply at once.

### Custom domains
- Bring-your-own domain per blog (owner + paid): add / list / remove in Settings with a CNAME instruction and live status badges.
- Hostname validation rejects the platform zone (apex + `*.<platformZone>`), IPs, and wildcards; non-subpath rows hold exclusive partial uniqueness, active subpath host ownership is unique, and abandoned never-verified rows reclaim after a 3-day TTL.
- Host-based post route mounted: an active custom domain serves posts at the root (`/`, `/:slug`, `.md`).
- Cloudflare-for-SaaS custom-hostname provisioning + DNS/SSL verification is wired and enabled at runtime by `CUSTOM_HOSTNAME_API_TOKEN` + zone config (production preflight requires the token/fallback). Reclaim tears down the old custom hostname so a squatter cannot block the real owner. See `docs/deploy.md`.

### Public output & SEO
- RSS feed, sitemap.xml, robots.txt, llms.txt (per-site + product variant), `content-signal` AI headers; per-site favicons (PWA manifest + light/dark theme-color only on marketing/legal chrome). `sitemap.xml` emits per-URL `<lastmod>`; RSS carries full sanitized article HTML in `<content:encoded>` plus channel `<lastBuildDate>` and `<atom:link rel="self">`.
- Per-post OG/Twitter/meta/canonical; `noindex` for unpaid blogs.
- Deterministic SEO and AI-answer (GEO) findings in `posts.preview` and `posts.seo_check` on every plan, Try free included: 31 code rules, 26 for search (metadata, headings, links, content, duplicates, indexing, optional focus keyword) and 5 for AI answers (opening paragraph before the first heading and under 80 words, number claims without a link, sections over 400 words, steps written as prose); no score. Editor SEO rail + publish-dialog findings.
- Judgment questions (does the opening answer the title, which claims need a source, does each section stand alone when quoted) live in the `vibecms-seo` skill for the customer's own agent; vibecms runs no AI model on content. The Workers AI SEO review was removed on 2026-10-22 (migration 0042 drops its cache table).
- Public caching (`s-maxage=300` + stale-while-revalidate + per-article cache tag) with purge on publish/archive and live site-setting changes (zone purge, fail-open); saving private post edits leaves the live cache unchanged.
- Marketing sitemap includes the landing, all docs collection pages, and legal pages; legal `<lastmod>` follows the displayed update date. Docs and legal pages share canonical and absolute OG/Twitter metadata.
- Marketing and docs misses render the branded HTML 404 with status 404; tenant not-found handling stays separate.
- Landing landmarks support skip navigation; the mobile menu has an opaque surface, focus-out dismissal and scroll locking. Hero autoplay has explicit Pause/Play and stops on manual selection.
- Docs use Geist Mono for code with lightweight copy controls; folder index pages retain their sidebar selection.

### Reader and AI discovery analytics
- Cookie-free first-party page views (JS beacon); dashboard ranges 7/30/90/365/all with previous-period comparison, top posts, and referring domains.
- First-party agent fetch counting on the public Worker (`agent_fetch`): known agent user agents, markdown/representation requests, and `Signature-Agent` presence; stores matched agent/category, resource, representation, and host - not full UA/IP. Covers proxied customer-subpath and custom-domain traffic the zone query cannot see.
- Raw Analytics Engine retention 90 days; D1 keeps 365-day detail then monthly all-time aggregates. Legacy zone-crawler rows only fill dates without agent data.
- AI referrals are identified by referrer hostname. No IP address, user agent, full referrer URL, persistent visitor ID, or visitor profile is stored for page views; DNT and Global Privacy Control opt out.
- Privacy disclosures distinguish reader beacons from server-side agent reads, essential app sessions, Cloudflare Email Sending, and Polar checkout, and state that vibecms runs no AI model on customer content.

### Agent surfaces
- MCP server at `POST /mcp` with 42 tools (sites/theme/voice/signup_form/location, redirects, tags, analytics, posts, assets, activity, versions + `posts.format_guide`, `posts.preview`, `posts.seo_check`, and the scope-free `skills.list`/`skills.get` that serve the agent skills to any valid key); JSON-RPC, 4 supported protocol versions (three initialize-era plus modern `2026-07-28`), per-tool scope + read/destructive/idempotent hints. Sign-in is required up front: `initialize`, `tools/list`, `server/discover`, legacy `notifications/initialized` and tool calls require a bearer credential. Missing credentials get HTTP 401 / JSON-RPC `-32001` with a `WWW-Authenticate` resource-metadata challenge (no `invalid_token`); invalid credentials retain `invalid_token`. OAuth-capable clients such as Claude web, desktop and Code offer Connect/Sign in; existing API-key users are unchanged. `tools/list` is scope-filtered with private caching; authenticated `server/discover` keeps public response caching because its result is identical across principals. OAuth metadata, trusted CIMD/public-client DCR, the static server card and HTTP agent skill files remain public.
- REST API `/api/v1` with 41 OpenAPI operations across 31 paths covering the same capabilities (`posts.search` maps to the posts-list search query) + public `GET /api/v1/openapi.json` and Scalar docs at `/api/v1/docs`. REST accepts agent keys only, not sign-in tokens.
- CLI `vibecms-cli` (login/whoami/site/posts/assets/activity/schema/skills, including posts get-by-slug, `posts publish --original-published-at` and `sites redirects list|set|delete`; `--json`/`--ndjson`/`--dry-run`, typed exit codes); update, restore, and publish require an expected version. `skills list` discovers available skills; `skills get [name...] [--dir <path>] [--force]` saves all skills by default or the named subset to `.agents/skills` or the chosen folder, and requires `--force` to overwrite existing files.
- Agent skills: every `skills/<name>/` folder is the only hand-edited source. `pnpm gen:agent-skills` bundles it, updates `skills-lock.json`, and writes exact copies to `plugins/vibecms/skills/<name>/` for the Claude Code plugin (no symlinks); the pre-commit check fails when any of them is stale. With no other code change a new skill is served at `/.well-known/agent-skills/` on the product and app hosts and by MCP/REST `skills.*`; `npx skills add https://vibecms.dev --skill '*'` installs them all. Run `npx skills update` to stay current, or save skills with `npx vibecms-cli skills get`.
- Seven skills: `vibecms-core`, `vibecms-writing`, `vibecms-seo`, plus task skills `vibecms-import` (Ghost/WordPress/Substack/Medium/Markdown with original dates, one batch approval, redirects and a completeness check), `vibecms-newsletter` (connect the owner's newsletter tool, RSS-to-email drafts), `vibecms-cross-post` (DEV, Hashnode and Medium copies pointing back to the original) and `vibecms-ship-to-draft` (a GitHub Actions workflow that drafts from merged `blog` PRs or releases and revises from `/vibecms` comments; it never publishes).
- Bearer tokens `vc_live_...` (HMAC-hashed, peppered, reveal-once, last-used tracking, owner-only management); 11 scopes; 4 key presets (`draft` default / `publish` / `manage` / legacy `full`); `assets:delete` is `full`-only; max 10 active keys and sign-in connections per blog.
- MCP and REST plan-limit errors include the installation's dashboard billing URL in both the message and `details.upgradeUrl` (JSON-RPC discovery errors use `error.data.details`); invalid credentials share one 401 replacement-key message linking to Connect without revealing whether the key existed.
- Typed `coverAssetId` + `canonicalUrl` on posts.create/update (set/clear cover, set canonical); persisted to posts + version snapshots and reverted by restore.

### AutoSEOPilot managed hosting
- Workspace-UUID-keyed, idempotent provision/status/revoke internal API with strict schemas, bounded bodies, correlation IDs, constant-time internal-secret checks, and raw-token redaction.
- Durable credential identity + monotonic generations prevent stale replay/reactivation; raw credentials are generated by AutoSEOPilot and only hashed by VibeCMS.
- Managed sponsorship participates in one effective hosted-entitlement check across publishing, media, indexing, analytics, custom domains, and API quotas without becoming a Polar subscription. Managed location check endpoint verifies a site's subpath mount.
- Revoke disables the managed key and sponsorship. It deletes nothing on the spot: the site, posts, versions, media, activity, domains and owner access all survive the revoke.
- Claim window ("keep your blog") after a revoke: the blog stays fully online on every address for 7 days, then serves a neutral "This blog is paused" page (noindex, never a bare 404) until it is claimed; an unclaimed blog is deleted 30 days after the revoke (custom hostname, R2 objects, posts, media, workspace, and the login unless that user has other workspaces).
- Claiming = signing in with the same email and buying vibecms Cloud: the same blog, posts, media and domain come back with no migration, and a claimed blog is never deleted by this flow again. The dashboard shows a "Keep your blog" banner with the exact deadline, and VibeCMS sends one reminder on days 7, 14, 21 and 28 (each exactly once; all of them stop on claim or on a resumed plan). AutoSEOPilot sends the day-0 email.

### Dashboard
- Overview, Analytics, Posts, Media, Subscribers, Activity, Theme, Settings, Connect, Billing, Setup.
- Connect-an-agent flow with focused snippets for Claude Code, Codex, Cursor, Droid, and generic MCP + a protected-read connection check + approval-first starter prompt.
- Success/error feedback via toast (`?ok=`/`?error=` params converted and cleared).
- Dashboard/login documents are `noindex` and use static-asset security headers, including a minimal CSP and frame denial, on SPA fallback routes as well as the root.
- Shared single-choice controls use Radix radio keyboard navigation. Clipboard controls confirm only successful writes and expose selectable text with an accessible failure message when copying fails.
- Controlled dialogs and sheets return focus to their opener; OTP rejection returns to the code input, and newly created keys receive focus in their reveal banner.
- Connect preserves a revealed key across refreshes in this tab until Done clears it; the reveal copy states that boundary explicitly.
- The overview counts a created key as its first required step and distinguishes key creation from an agent's first connection. Analytics configuration/read failures explain the unavailable data and offer Check again.

### Onboarding
- One visible path: Blog setup -> Personalize -> Connect agent -> First draft -> Review exact version -> Publish proof, with manual writing as a fallback.
- Setup collects name plus an editable name-derived slug, then navigates to `/dashboard/personalize`. No website-URL prefill, no scraping/import.
- Setup uses one client/server address normalizer and reserved list. New addresses need at least 3 normalized characters; empty or non-Latin-only derivations prompt for an explicit address. Taken addresses, including racing claims, show a field error without losing entered values.
- The address is permanent after setup; the blog name remains editable. Setup and personalize include sign-out.

### Billing (hosted)
- Polar checkout (monthly + yearly) + customer portal (owner-only); webhook flips subscription status. Checkout validates product, discount, currency, and net amount.
- Shared Polar organization: customers (one per email) and webhooks are shared with the organization's other products. Only subscription/checkout events for the configured monthly or yearly product change billing, the workspace comes only from the checkout metadata Polar copies to the subscription, and checkout never writes customer metadata. One Polar customer may pay for several blogs (migration 0046 drops the customer-ID uniqueness), and the portal opens for the stored Polar customer, falling back to the workspace external ID.
- One live subscription per blog: while a blog's subscription is active or past due, another vibecms subscription for it (two checkouts paid) changes nothing. It is recorded once in `polar_duplicate_subscriptions`; once paid, support gets a "Refund needed" email to refund and revoke it, and the claim sweep resends a notice that was not accepted.
- Webhook ordering: one atomic batch inserts a receipt with a fresh request nonce and gates every billing write on that nonce; duplicate delivery never changes billing, including legacy receipts. Two strictly-newer millisecond watermarks order status/customer (`webhook_updated_at`, all events) and subscription ID/period/cancel flag (`subscription_updated_at`, subscription events only). Equal timestamps leave that group unchanged (a conflicting status logs a structured warning). A subscription event may apply its fields while stale for status, or vice versa; `applied` means either group changed. Checkout cannot clear subscription fields or prevent an earlier subscription event from populating them. `current_period_end` stays in Unix seconds.
- Scheduled cancellation: an `active` subscription with `cancel_at_period_end` stays paid until `current_period_end`; Plan & billing shows "Ends <date>" instead of "Renews <date>". Once the subscription has ended, checkout opens again.
- Past due: paid features stay on for a 7-day grace (`PAST_DUE_GRACE_DAYS`) from the first failed renewal (`past_due_since`), then pause as on the free plan; nothing is deleted, including domain/subpath location settings. Recovery to `active` restores paid features at once; `canceled`/`unpaid`/revoked end paid access with no grace. Checkout is refused with `payment_past_due` throughout. Every dashboard page shows a past-due banner ("Your last payment failed. Paid features stay on until <date>." / "… Paid features are paused.") from the billing snapshot's `graceEndsAt` (epoch ms), flipping to paused live when the deadline passes; owners get **Update payment** (customer portal), non-owners an ask-the-owner note. Plan & billing repeats the message, keeps the paid heading, highlights the Paid column only during grace, and offers **Update payment** as the only action. The portal and canceled checkout return to `/dashboard/billing` with no status params.
- Grace transitions: only an accepted status update can change `past_due_since`. Entering `past_due` starts it at the event's ordering timestamp; repeated `past_due` preserves it, including a legacy `NULL` (no retroactive grace). Leaving `past_due` clears it; stale or duplicate status deliveries never alter it. Migration 0037 converts ordering keys to milliseconds, seeds the subscription watermark from the converted status watermark, and leaves legacy grace starts and receipt nonces `NULL`.
- Accepted delivery-delay limitation: if a later `past_due` event arrives before a delayed initial failure, grace counts from the first one applied, not from receipt-history reconciliation. Delays occur while our endpoint is failing and Polar retries; the error favours the customer by at most that delivery delay.
- List price $15/month or $150/year; launch offer $9/month or $75/year while displayed.
- Free tier: drafting + agent tokens + 5 published posts, 5 drafts at a time, 10 images (noindex), and a small "Published with vibecms" footer link to vibecms.dev on every tenant blog page. Paid: unlimited posts, 10 GB media, search indexing, custom domains, subpath location, reader + AI discovery analytics, no footer link, and 5,000 agent requests a day (120 a minute, 500 writes a day, 60 requests a minute per key, no monthly cap). Self-hosted never shows the link.

### Quotas, security, export
- API/MCP quota counters (hosted): per-minute/day/month call caps and day/month write caps on free; paid has per-minute/day call caps and a daily write cap with no monthly cap (monthly totals still counted for the dashboard); per-token per-minute call caps on both, with `X-RateLimit-*` headers.
- MCP write classification comes from the operation registry's read-only annotation, including scheduling, unscheduling, preview rotation, unarchive and asset metadata updates. REST charges equivalent mutations as writes.
- Same-origin CSRF guards (`rejectCrossOriginBrowserPost`) on the Hono cookie-authenticated dashboard mutations and media POSTs.
- Subscriber capture with explicit consent text + version, honeypot, rate limiting, and hashed IP/UA. Owners can instead connect their own newsletter tool (`externalForm`: HTTPS form action + email field): the blog form then posts straight to that tool in a new tab, vibecms stores no new signups, and the page CSP `form-action` allows exactly that origin.
- Owner-only JSON export of every post (`GET /api/export.json`): current and live snapshots plus referenced media metadata/URLs, not full version history, image binaries, subscribers, or all site settings. See the [export boundaries](../apps/public/src/content/docs/content/export.mdx).
- Self-hosted mode (`SELF_HOSTED=true`): billing always active, no quotas, always indexable.
- Unexpected REST/MCP exceptions log redacted message, stack and bounded causes once, correlated with the response request ID; responses remain generic.
- Each production deploy records its pre-deploy UTC timestamp in the job summary as the D1 Time Travel recovery point; nothing is uploaded as an artifact because the repo is public.

---

## In progress

- (none currently)

---

## Planned

- **Google/GitHub OAuth sign-in**: code is wired in `auth.ts` and appears only when the corresponding client credentials are provisioned. Email OTP remains the default.
- **Newsletter delivery by vibecms** (ON HOLD): vibecms sends no email. Owners connect their own tool (signup form posts to it; the `vibecms-newsletter` skill sets up RSS-to-email drafts there). Native confirmation/sends stay deferred.
- **WebMCP** (plan 025, ON HOLD) and **IndexNow** (plan 026, ON HOLD): design records exist; not started. Plan 026's redirects and original dates shipped 2026-10-28; its server-side import parsers were replaced by the agent-driven `vibecms-import` skill.

---

## Skipped / out of scope

- **Multi-blog / teams / comments**: single-blog-per-workspace by design.
- **Page builder or block-canonical content model**: intentionally skipped. Markdown stays canonical; the visual block canvas is a capability-gated editing adapter, not a second storage format.
- **Platform-authored AI content**: the agent is the intelligence; the platform validates/nudges (e.g. `posts.format_guide`, `posts.preview`, `posts.seo_check`) but never writes content.
- **Platform-run AI review**: removed 2026-10-22 (plan 028). The platform checks with code; the customer's agent makes judgment calls with its own model, so we pay no inference and send no content to a model.

---

## How to maintain this

- When you ship something, move it from Planned/In progress to Shipped with the date.
- When you decide not to do something, record it under Skipped with a one-line reason.
- Keep entries terse; this is a ledger, not documentation. Deep docs live elsewhere in `docs/`.
