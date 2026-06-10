# Changelog

All notable changes to VibeCMS will be documented in this file.

## Unreleased

- Cohesive design system: token-driven light + dark themes (oklch, single green accent), Geist/Geist Mono, motion + radius tokens. Removed unused Instrument Serif.
- Marketing site rebuilt on tokens with honest dev-tool visuals (MCP write and REST read samples), canonical copy, accessible structure, and no fabricated screenshots.
- Dashboard redesigned on a shared `AppFrame`/`DashboardShell`/`OnboardingFrame` with Radix icons, mobile nav, skip link, and consistent spacing.
- Inline success/error feedback for every form via post-redirect status codes; pending and destructive-confirm states; copy-to-clipboard for the one-time API token.
- One-time API token reveal hardened with a short-lived HttpOnly cookie handoff cleared server-side.
- Public blog markdown renderer expanded (links, lists, code, blockquotes) with safe-href scheme allowlisting and per-post SEO metadata.
- Centralized brand, pricing, media, and entitlement copy in `@vc/config`; removed the unused `PLAN` constant and a duplicate `dependencies` block in `@vc/ui`.
- Replaced the uncustomized RedwoodSDK starter page.

## 0.1.0-alpha

- Initial VibeCMS Cloudflare Worker app.
- Better Auth email/password auth.
- Onboarding and single-blog setup.
- Posts dashboard with create, edit, publish, and archive flows.
- Public hosted blog rendering.
- D1 schema and migrations.
- R2 image uploads with JPEG/PNG/WebP/GIF allowlist and 10MB max image size.
- Activity history and post version history.
- Scoped `vc_` API keys.
- MCP endpoint for trusted agent access.
- Polar checkout, portal, and webhook billing for hosted mode.
- `SELF_HOSTED=true` mode for billing-free self-hosting.
- Root Deploy-to-Cloudflare self-host configuration.
