# Changelog

All notable changes to VibeCMS will be documented in this file.

## Unreleased

- Migrated the web app from RedwoodSDK to TanStack Start (on the Cloudflare Vite plugin) so it runs on the Workers **Free** plan: public and blog pages are SSR with edge cache plus per-article tag purge, the dashboard is a client SPA over auth-gated server functions, and the agent API stays cheap JSON. `dev.vibecms.dev` is cut over to the new app; a concurrent fresh-request burst that returned 503 (Error 1102) on RedwoodSDK now returns 200. The shared `@vc/*` packages (core, db, validators, mcp, config, ui) are unchanged.
- Full dark dev-tool visual redesign of the landing page and dashboard. The marketing landing is a new dark, terminal-flavored design (Space Grotesk display + Hanken Grotesk body + JetBrains Mono labels, all self-hosted; bright-green accent, dot-grid texture, glass and panel surfaces, editor/terminal mockups, scroll-reveal and the live scope-toggle demo). The design tokens were retuned to the new palette in oklch: the landing renders dark always, while the dashboard, auth, and onboarding carry the same language across both light and dark. Borders and inputs meet WCAG non-text contrast in both modes. No behavior, route, or form changes - visual only.
- Passwordless sign-in: replaced email + password with a 6-digit email OTP (the account is created and the email verified on the first valid code, so impersonation via an unowned address is no longer possible), plus an optional "Continue with Google" button that appears only when Google OAuth credentials are configured. Codes are emailed via Plunk in production (`PLUNK_API_KEY`/`EMAIL_FROM` on a Plunk-verified sender domain) and logged to the Worker console when unset for local testing. No schema change - reuses Better Auth's existing `verification` and `account` tables.
- OTP send abuse guard: each recipient email is capped at 5 codes/hour in durable D1 storage (a dedicated `rate_limits` table, atomic conditional `UPDATE` so concurrent sends cannot overshoot), keyed on the recipient - not source IP, which rotates and would punish shared networks. Only requests Better Auth would actually accept count against the cap (gated on JSON content type and a plausible address), so a rejected request cannot lock a victim out, and the limiter fails open if storage is unavailable.
- Draft-free, publish-one-free hosted model: signing up, naming a blog, drafting/editing posts, creating agent tokens, and connecting agents over MCP are free. Each workspace can publish ONE post free to try the full loop end to end - it renders live but `noindex,nofollow` - and a subscription is required to publish more, upload media, and make posts search-indexable. Enforced for both the dashboard and the agent (MCP) path; unpaid usage is bounded by a new free API tier; self-host stays fully free.
- Hardened the publish-one-free path after review: the free-publish cap is now enforced atomically in the DB write (a conditional `UPDATE` whose count check D1 serializes), closing a concurrent-publish race; and unpaid blogs are kept out of discovery - no sitemap entry, and `noindex,nofollow` plus `content-signal: search=no` on their feed, `llms.txt`, and markdown responses (the HTML page was already `noindex`).
- New "Connect your agent" onboarding step (`/app/connect`): after blog setup you land here, generate a safe draft-only token in one click, and get ready-to-paste setup for Claude Code, Codex, Cursor, and any MCP client (plus an `mcp-remote` bridge for stdio-only clients) with the token baked in, followed by a starter prompt to hand the agent its first task. Skippable, and always reachable from Settings.
- Agent token scopes simplified to two presets - Draft assistant (default, no publish) and Full publisher - replacing the per-scope checkbox grid.
- The one-time token reveal now also drives the connect step (cookie scoped to `/app`), so the freshly minted token appears inline in every client snippet.
- Cohesive design system: token-driven light + dark themes (oklch, single green accent), Geist/Geist Mono, motion + radius tokens. Removed unused Instrument Serif.
- Marketing site rebuilt on tokens with honest dev-tool visuals (MCP write and REST read samples), canonical copy, accessible structure, and no fabricated screenshots.
- Dashboard redesigned on a shared `AppFrame`/`DashboardShell`/`OnboardingFrame` with Radix icons, mobile nav, skip link, and consistent spacing.
- Inline success/error feedback for every form via post-redirect status codes; pending and destructive-confirm states; copy-to-clipboard for the one-time API token.
- One-time API token reveal hardened with a short-lived HttpOnly cookie handoff cleared server-side.
- Public blog markdown renderer expanded (links, lists, code, blockquotes) with safe-href scheme allowlisting and per-post SEO metadata.
- Centralized brand, pricing, media, and entitlement copy in `@vc/config`; removed the unused `PLAN` constant and a duplicate `dependencies` block in `@vc/ui`.
- Replaced the uncustomized RedwoodSDK starter page.
- Workspace-level API quotas shared by MCP and REST (per-minute/day/month calls, daily/monthly writes, plus a per-token burst cap); over-limit requests return `429` with machine-readable `RATE_LIMIT` (REST) and a JSON-RPC rate-limit error (MCP). Self-hosted mode is exempt. Dashboard shows live usage meters.
- API tokens capped per workspace (10 active) as a leak/abuse guard; over-limit creation returns a clear "token limit reached" message.
- Fixed yearly checkout silently charging the monthly product when no yearly product is configured; yearly now requires its own product or returns a clear "yearly unavailable" message.
- Launch smoke suite extended to cover the REST/MCP happy path and the quota-denial (`429`) path.
- MCP `initialize` now returns server `instructions` so a connecting agent learns the draft->publish flow (no scheduling), post format and limits, image upload, and rate-limit handling without trial and error; tool descriptions sharpened to reinforce the workflow.
- MCP transport conformance: negotiate protocol version (advertise `2025-06-18`, echo a supported requested version, reject an unsupported `MCP-Protocol-Version` header), `GET /mcp` returns `405`, and custom tool metadata moved under `_meta` instead of non-standard top-level Tool keys. Recoverable tool errors (invalid input, duplicate slug, not found) now return as `CallToolResult{isError:true}` so agents self-correct, while auth/billing/rate-limit/protocol errors stay JSON-RPC. MCP `assets.upload` now records the real workspace and maps upload failures to clear messages.
- Removed the hosted free trial. Hosted billing is now subscribe-to-publish only (a single 5 GB media tier, no trial storage cap); self-host stays free and fully unblocked. Dropped the `trialing` status, trial quota tier, trial-expiry handling, and all trial copy/CTAs; public blogs are indexable once active (or self-hosted). Migration `0006_remove_trial.sql` normalizes any legacy trialing rows.
- Post editor now auto-derives the slug from the title for new posts, without overwriting a manually edited slug.
- Dashboard splits the conflated tokens/versions stat into distinct "Active tokens" and "Saved versions" cards.
- Agent-ready by default: every public blog serves `llms.txt` (content index linking to clean markdown) and per-post markdown via `Accept: text/markdown`, a `.md` suffix, or `?format=md` - the post's own source, zero-loss, with YAML frontmatter - on both custom-domain and `/blog/:siteSlug` paths. The product host also serves a `llms.txt`, `sitemap.xml`, and a sitemap-referencing `robots.txt`. Combined with the MCP endpoint, this covers the standard AI Agent Readiness checks (robots, sitemap, llms.txt, markdown, MCP).
- Fixed a data-loss bug where a partial `posts.update` (e.g. changing only the excerpt or title via MCP/REST) wiped the post body and tags: the shared zod schema's `.default("")`/`.default([])` survived `.partial()`, so omitted fields parsed to empty values instead of `undefined`. `updatePostInput` is now a true patch (all fields optional, no defaults); unspecified fields are preserved. Create-time defaults are unchanged.
- Checkout failures now surface a distinct `checkout_failed` status (and log the underlying Polar error) instead of the misleading `polar_unconfigured`, which implied missing secrets when the real cause was elsewhere (e.g. a customer email Polar rejects).

## 0.1.0-alpha

- Initial VibeCMS Cloudflare Worker app.
- Better Auth email/password auth.
- Onboarding and single-blog setup.
- Posts dashboard with create, edit, publish, and archive flows.
- Public hosted blog rendering.
- D1 schema and migrations.
- R2 image uploads with JPEG/PNG/WebP/GIF allowlist and 10MB max image size.
- Activity history and post version history.
- Scoped `vc_` agent tokens.
- MCP endpoint for trusted agent access.
- Polar checkout, portal, and webhook billing for hosted mode.
- `SELF_HOSTED=true` mode for billing-free self-hosting.
- Root Deploy-to-Cloudflare self-host configuration.
