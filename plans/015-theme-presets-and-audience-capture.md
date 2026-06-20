# 015 - Theme presets + per-preset agent guidance + audience capture

Status: PLANNED (architecture, Oracle-reviewed GO-WITH-CHANGES; P1/P2/P3 folded in). Written 2026-06-19. DEPENDS ON 016 (rich content renderer + the shared render contract) landing first - presets skin the components 016 emits and reuse its `RichContentFrame`.

## Goal
A small catalog of THEME PRESETS that skin the rendered-markdown vocabulary (callouts / TOC / captioned figures / code / prose) over ONE semantic DOM; a Settings picker with honest, canonical-sample live preview; per-preset authoring guidance the agent fetches (via 016's versioned `format_guide`); and a first-party audience-capture (email) widget that stores signups now with honest copy while sending is deferred to 017.

## Why / ordering
A preset is a token set + a thin authoring-guidance doc, NOT a code fork. The renderer (016) emits one semantic DOM with stable data attributes and a shared `RichContentFrame`; presets only re-skin via CSS variables and only RECOMMEND layout (tonal), never change syntax. So 016 first; 015 skins + teaches per-preset layout + captures audience. Newsletter SENDING is 017 (Plunk); 015 only captures.

## Current state (grounded - corrects stale memory)
- NO `sites.theme` column today: migration 0004 added `minimal|editorial|terminal` (default minimal), 0005 reverted it. No resolver, allowlist, picker, or per-theme CSS. (packages/db/drizzle/0004,0005; schema.ts:26-40; public-blog-data.ts:46-85)
- Public blog CSS = one stylesheet `public-blog.module.css`, `.publicPage`-scoped tokens (`--blog-*`). The dashboard editor preview styles markdown with SEPARATE Tailwind selectors, not this module (Oracle grounding) - 016 unifies both onto the shared frame. No `data-theme`.
- Tailwind v4 via `@tailwindcss/vite`; `styles.css` uses `@theme inline` + `:root`/`.dark`. `@tailwindcss/typography` NOT installed.
- Settings persists name/description/SEO only - no theme field; page is billing/token oriented. (SettingsPage.tsx:26-35,166-206; dashboard-pages-fn.ts:27-66; onboarding.ts:125-195)
- MCP is custom JSON-RPC, TOOLS-only -> `format_guide` is a tool (016).

## Architecture (source-verified)
### Token contract (one vocabulary; every preset fills it)
`--vc-*` token set (shadcn-style semantic fg pairs + GitHub alert types + a Tailwind Typography `--tw-prose-*` bridge):
- surface: `--vc-bg --vc-fg --vc-muted --vc-muted-fg --vc-card --vc-card-fg --vc-border --vc-accent --vc-accent-fg --vc-link`
- callouts: `--vc-callout-{note|tip|important|warning|caution}` + `-fg` (+ optional `-border`)
- code: `--vc-code-bg --vc-code-fg --vc-code-border --vc-code-inline-bg`
- quote: `--vc-quote-fg --vc-quote-border`; figure: `--vc-figure-bg --vc-caption-fg`
- type: `--vc-font-body --vc-font-heading --vc-font-mono --vc-prose-measure --vc-prose-leading --vc-heading-scale`
- space/radius: `--vc-prose-gap --vc-section-gap --vc-radius`
Migrate the existing `--blog-*` tokens onto this vocabulary.

### Preset mechanism (Tailwind v4-correct)
- Preset VALUES are ordinary CSS variables in `@layer base` under `[data-vc-theme="<id>"]`. NOT `@theme` (Tailwind docs: `@theme` vars must be top-level/un-nested).
- `@theme inline` ONLY aliases the few tokens we want as Tailwind utilities (e.g. `--color-vc-accent: var(--vc-accent)`).
- Dark in v1 (RESOLVED, P2-8): each preset ships light AND dark token values. System default via `@media (prefers-color-scheme: dark)` inside each preset selector; manual override via `[data-vc-mode="dark"]`/`["light"]` after the media rules.
- `data-vc-theme={site.theme}` (+ optional `data-vc-mode`) on the shared `RichContentFrame` root (public + previews). Borrow daisyUI's data-attribute scoping pattern (not daisyUI itself).

### Prose
Adopt `@tailwindcss/typography`; drive `--tw-prose-*` from `--vc-*` so prose tracks the preset + dark. Hand-roll only the 016 components (callouts / TOC / figure chrome / code wrapper). Fumadocs is the model; shadcn for semantic fg pairs.

### Preset registry + per-preset guidance (TONAL, mapped to real syntax)
Guidance = stable syntax + tonal recommendations, never per-theme syntax forks (GitHub/Nextra/Fumadocs precedent). EVERY recommendation MUST map to a component the renderer actually emits (P2-6): no "pull quotes" as a phantom component - Editorial instead says "use ordinary Markdown blockquotes sparingly as pull quotes", and blockquotes are styled acceptably across presets. Preset record in a shared registry (packages/config - RESOLVED, alongside PRICING/FORM_STATUS, no DB deps):
```
{ id, name, designIntent, recommendedComponents, componentEmphasis, preferredImageRatio, density, idealArchetypes, formatGuide }
```
`recommendedComponents`/`componentEmphasis` only RANK usage (P3-3); supported syntax lives once at the renderer. `formatGuide` = a short tonal doc. 016's `format_guide` tool serves the active site's preset guidance (versioned); the picker shows `designIntent` + a live preview.

### v1 preset catalog (4 - sharpened jobs, P2-7)
- Minimal (default): Geist sans, airy, neutral. General purpose. Guidance: short callouts, light structure.
- Editorial: serif headings, wide measure, media-heavy/narrative. Guidance: strong lead, a figure every 2-3 sections, blockquotes sparingly as pull quotes, sparing code.
- Technical: sans + mono emphasis, prominent TOC, tight density; docs/tutorial/reference. Guidance: `[[toc]]` for long posts, callouts for warnings/tips, fenced code with language.
- Product/Launch (CONFIRMED): founder/company-update aesthetic - clean, confident, conversion-aware; pairs naturally with audience capture. Strong WITHOUT syntax highlighting (deferred). Guidance: lead with the announcement, callouts for highlights/availability, short scannable sections, a captioned hero image, CTA-friendly close. (Terminal revisited as a future preset once Shiki lands.)

### Audience capture (honest UX while send is deferred - P1-3)
- First-party widget, TWO placements (P2-9): end-of-post inline (after the article body) + footer/index. NO modal, NO sticky takeover.
- Honest copy: "Get future posts when email delivery launches" (early-list framing). Success state MUST NOT say "You're subscribed" or "Check your inbox" until 017. Theme-neutral, privacy-forward (email only, first-party storage).
- New D1 `subscribers` table: `id, site_id, email (normalized), status ('pending'|'confirmed'|'unsubscribed'), source_url, consent_text, consent_version, created_at, confirmed_at, provider_id (nullable), ip_hash/ua_hash (optional)`. Store `consent_text`/`consent_version` exactly as shown.
- Double-opt-in modeled now (insert `pending`); confirmation send + `confirmed` flip deferred to 017 (Plunk).
- Failures private + recoverable: invalid email inline; honeypot -> generic success/no-op; rate limit -> generic "try later"; duplicate email -> the SAME neutral success copy (idempotent, no enumeration).

## Settings picker UX (P2-1, P2-2)
- IA (P3-1): a new "Public blog" panel (theme + capture) distinct from Agent access / Billing / Data; update the Settings header framing.
- Each preset card states: "Changes public blog appearance and future agent guidance. Does not rewrite existing content." Show "Current live theme", "Default", and unsaved-selection states. CTA "Save theme" + secondary "View public blog" after save.
- Live preview reuses the SAME renderer + `RichContentFrame`. Default content = a CANONICAL sample exercising the full vocabulary (H2/H3, NOTE/TIP/WARNING callouts, `[[toc]]`, captioned image, code), labeled "illustrative". If the site has posts, a toggle: "Sample content" vs "Latest post". A preview-only Light/Dark/System toggle (public runtime still follows `data-vc-mode`/system).

## Scope (files)
- packages/db: migration re-adding `sites.theme` (allowlisted, default 'minimal') + new `subscribers` table; `schema.ts`; subscribers repo.
- apps/web-next/src/server/public-blog-data.ts (+ public-blog.ts loaders): SELECT + validate `theme` against the allowlist (default 'minimal'); thread through loader data.
- apps/web-next/src/components/PublicBlogPages.tsx: `data-vc-theme` (+ mode) on the shared frame root; add `<SubscribeForm>` at end-of-post + footer.
- apps/web-next/src/components/public-blog.module.css (+ shared frame) -> migrate to `--vc-*`; preset blocks (dedicated `presets.css` under `@layer base`) + dark; apps/web-next/src/styles.css `@theme inline` aliases.
- apps/web-next/package.json: add `@tailwindcss/typography`.
- Settings: SettingsPage.tsx "Public blog" panel (picker cards + canonical-sample preview + preview mode toggle), dashboard-pages-fn.ts (`updateSiteSettingsMutation` + load), onboarding.ts (`getSiteSettings`/`updateSiteSettingsForApp` persist theme). FORM_STATUS code in packages/config if a redirect status is needed.
- Preset registry: packages/config - records + guidance docs (consumed by the picker, public render, and 016's `format_guide`).
- Capture: `<SubscribeForm>` + a public server fn/endpoint (rate-limited, honeypot) + subscribers repo write.

## Phases (each gated by manual dev verification)
1. Token contract + preset mechanism: migrate `--blog-*` -> `--vc-*`, add preset blocks + dark, `@theme` aliases, adopt typography (atop 016's shared frame). Verify: public blog unchanged under 'minimal'; switching `data-vc-theme` reskins in light + dark.
2. Re-add `sites.theme` (migration + resolver + allowlist/default) + thread to `data-vc-theme`. Verify: a site's stored theme drives the public skin.
3. Settings "Public blog" panel: picker cards + canonical-sample preview + mode toggle + persistence. Verify on dev: pick a preset, save, public blog reflects it; preview matches public.
4. Preset registry + per-preset guidance content; wire 016's `format_guide` to return the active preset's guidance. Verify: format_guide returns Editorial-vs-Technical guidance per site.
5. Audience capture: subscribers table + `<SubscribeForm>` (both placements) + endpoint + honeypot + honest copy. Verify on dev: submit -> 'pending' row; duplicate -> same neutral success; honeypot no-op; no email sent.

## Acceptance / verification
- Each preset renders the SAME post with correctly reskinned callouts / TOC / figures / code / prose, in light + dark; preview == public == editor (shared frame).
- The picker persists; cards communicate scope ("does not rewrite existing content").
- `format_guide` returns preset-appropriate guidance for the active site.
- Subscribe writes 'pending'; copy never implies a confirmed subscription; honeypot blocks bots; duplicate is idempotent; NO email sent (017).
- Gates: `pnpm -r typecheck` + `lint` + `public:audit` green; no em-dash; migration applied on dev; bundle delta acceptable.

## Out of scope
- Newsletter SENDING / confirmation emails (017, Plunk).
- Per-preset SYNTAX forks (rejected - tonal guidance only).
- Custom font upload / full theme editor.

## Open decisions for review
None blocking - all design decisions resolved. (4th preset = Product/Launch; dark per-preset in v1; registry = packages/config; capture = end-of-post + footer; `recommendedComponents`/`componentEmphasis`; guidance maps only to real components.) Sole impl-time choice lives in 016: admonition plugin (`remark-github-beta-blockquote-admonitions` vs `rehype-callouts`), decided on bundle/control during the build.
