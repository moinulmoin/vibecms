# 016 - Rich content components + agent content fidelity

Status: DONE - shipped to dev 2026-06-19 (worker `0cac6345`). Implemented via parallel subagents, Oracle-reviewed (GO-WITH-CHANGES, all P1/P2 folded in), Reviewer-passed (4 P2 fixes: scope enforcement on the new read ops, preview length cap, MCP catalog entry for posts.preview, corrected captioned-image grammar), gates green (21 vitest tests incl. parity + XSS), verified end-to-end on dev (preview + format_guide + public render). Follow-up noted: the editor preview ships the renderer client-side (~110 kB gzip) - candidate for server-driven preview.

## Goal
Give blogs a rich rendering vocabulary (callouts, table of contents, captioned images, code) and a CLOSED, verified loop that teaches agents to use it - so agent-authored posts render beautifully and the agent can see and self-check exactly what will publish. This is the agent-native moat: high-fidelity authoring with zero dialect to learn.

## Why this ordering
A preset is a token set + a thin authoring-guidance doc, not a code fork. The renderer (016) emits one semantic DOM with stable data attributes; presets (015) only re-skin it and only RECOMMEND layout (tonal). So 016 lands first; 015 styles what this builds. Analytics (013) is independent.

## Decision: remark/rehype to React, NOT MDX (librarian, source-verified)
- Content is agent-authored, multi-tenant, rendered at request time on Workers, so it is UNTRUSTED. MDX compiles user text to evaluated JavaScript; for untrusted runtime content that is a code-exec/XSS hole and post-hoc HTML sanitizing does not undo execution. AVOID MDX and the Fumadocs/Nextra runtimes; BORROW their UI patterns only.
- Pipeline (pure-JS, Worker-safe): `unified` + `remark-parse` + `remark-gfm` -> admonitions (`remark-github-beta-blockquote-admonitions` or `rehype-callouts`) -> `remark-rehype` (allowDangerousHtml:false) -> `rehype-slug` (tenant/content-prefixed ids) -> custom TOC-collector -> custom captioned-image transform -> `rehype-sanitize` (narrow extended schema, run LAST) -> `rehype-react` -> React nodes.
- The current renderer (`apps/web-next/src/lib/markdown.tsx` `parseMarkdown`) returns React elements and is consumed by `components/PublicBlogPages.tsx` and `components/dashboard/MarkdownEditor.tsx`. End the new pipeline in `rehype-react` (React nodes), NOT `dangerouslySetInnerHTML`; `rehype-sanitize` is defense-in-depth, React escaping is the second layer. Preserve the `safeHref` URL allowlist inside the sanitize schema. Never enable `rehype-raw`/`allowDangerousHtml`.

### ONE render contract (P1-1 - the WYSIWYG guarantee)
WYSIWYG is the core promise, so there is exactly ONE rendering path with NO per-surface drift:
- One `renderRichContent(markdown, { presetId }) -> { node, outline, warnings }` over the pipeline above; a single thin `renderToStaticMarkup` wrapper produces the HTML string for `posts.preview`.
- A shared `RichContentFrame` (a stable root class + data attributes: `data-rich-content`, `data-vc-theme`) wraps the output. ALL FOUR surfaces use it: public post, dashboard editor preview, Settings preset preview (015), and `posts.preview` static output. Today the editor preview styles markdown with Tailwind selectors in a SEPARATE container (Oracle grounding) - that divergence is removed; the editor preview adopts the shared frame + `--vc-*` tokens.
- `posts.preview` ALWAYS returns `{ html, outline, warnings, rendererVersion }` (never "html OR structured"). `rendererVersion` lets clients/agents detect renderer changes.
- Parity guard: a fixture post containing a callout, `[[toc]]`, a captioned image, a code block, raw HTML, and an unsafe link renders identically across surfaces (golden test).

## v1 component set + syntax (agents already emit GFM, so fidelity is near-free)
- Callouts: GitHub/Obsidian blockquote alerts `> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]`. (`:::note` directives reserved as future opt-in.)
- Table of contents: explicit `[[toc]]` marker (RESOLVED, P2-3) - agent-friendly, deliberately placed and previewable. NO auto-outline in v1. If `[[toc]]` is present but there are no H2/H3, preview warns and renders an inert placeholder (preview only); a long post with no marker yields a preview suggestion to add one.
- Captioned images: exact grammar (P2-5) - an image line IMMEDIATELY followed by a single emphasis-only line (no blank line between) becomes `<figure><img><figcaption>`; otherwise a plain image. Require non-empty alt; preview warns on empty alt.
- Code blocks: fenced code with language label. Syntax HIGHLIGHTING (Shiki@4) is a measured fast-follow, NOT v1 (heavy dep, needs Node>=20 tooling). v1 code MUST still get strong baseline UX (P2-4): visible language label from the fence, readable light/dark contrast, horizontal-overflow scrolling, and class/data hooks reserved for future highlighting. Terminal/Technical marketing must not depend on highlighted code until a highlighter lands.

## Agent fidelity layer - a VERSIONED, VERIFIED closed loop (P1-2)
Teaching alone is not enough; the loop must let an agent detect off-skin output.
- `posts.format_guide` (a TOOL - MCP exposes tools only today, no resource support): returns `{ activePresetId, activePresetName, guideVersion, rendererVersion, recommendedComponents, presetGuidance, examples }` - the universal syntax PLUS the active preset's tonal guidance with concise do/don't examples. Ships in 016 returning the universal/default guide; 015 adds the `sites.theme` preset column + per-preset CONTENT it keys off. `tools/list` description says "call before drafting or publishing; response is site-theme-aware" (P3-4).
- `posts.preview` (TOOL + REST `POST /api/v1/posts/preview`): runs the SAME `renderRichContent` server-side and returns `{ html, outline, warnings, rendererVersion }` so an agent self-checks before publishing. WYSIWYG follows from the single render contract above.
- Shared validator (used by preview, and surfaced NON-FATALLY by publish/update): unknown/typo'd callout type; raw HTML stripped; unsafe URL rewritten; `[[toc]]` with no H2/H3; long post with no TOC; code fence missing language; image missing alt (or, where the preset encourages figures, missing caption). Warnings never block publish; they inform.
- `SKILL.md`: a shippable skill doc for coding agents (same vocabulary), referenced from onboarding/docs.
- Onboarding/ConnectAgent copy states the loop explicitly: fetch `format_guide` -> draft -> `posts.preview` -> publish.

## Theming hooks (consumed by 015, emitted here)
Renderer emits stable, semantic markup with data attributes: `data-rich-content`, `data-callout="note"`, `figure[data-captioned]`, `pre[data-lang]`. 015 defines CSS presets as variables under `[data-vc-theme="<id>"]` (+ a `[data-vc-mode]` dark override) and (re)introduces the `sites.theme` column + picker (added in migration 0004, reverted in 0005, so it does NOT exist today). Markup is shared across tenants; each tenant selects a preset.

## Scope (files)
- `apps/web-next/package.json` - add the unified/remark/rehype/rehype-react/rehype-sanitize stack (+ admonition plugin). Verify Worker bundle/cold-start impact.
- `apps/web-next/src/lib/markdown.tsx` - replace the single-pass parser with `renderRichContent` (the pipeline); keep an exported function returning `ReactNode[]` for the two existing consumers. Add the static `renderToStaticMarkup` wrapper + the shared validator. Fold `safeHref` into the sanitize schema.
- `apps/web-next/src/components/dashboard/MarkdownEditor.tsx` - switch the preview to the shared `RichContentFrame` + `--vc-*` tokens (remove the divergent Tailwind-selector preview).
- `apps/web-next/src/components/public-blog.module.css` (+ the shared frame styles) - callouts/TOC/figure/code styling via CSS variables + data attributes.
- Fidelity: `packages/mcp` + `packages/api-contract/src` + `apps/web-next/src/server/{operations.ts,mcp-dispatch.ts,api/routes.ts}` - add `posts.preview` and `posts.format_guide` as TOOLS following the existing operation pattern (Zod request in `requests.ts` + response DTO in `dto.ts` + registry entry in `operations.ts` + handler in `operations.ts` + a case in `mcp-dispatch.ts` + a REST route in `api/routes.ts`). Plus a new `SKILL.md`.

## Phases (each gated by manual verification on dev)
1. `renderRichContent` + shared `RichContentFrame`: GFM + callouts + `[[toc]]` + captioned images + baseline-styled code, sanitized, React nodes. Switch BOTH consumers (public + editor preview) to the frame. Verify: identical render across public + editor; existing posts still render; sanitize blocks script/`javascript:`/raw HTML (XSS test); fixture parity golden test passes.
2. Theming hooks: emit data attributes + a default `--vc-*` set (no preset switching yet - that is 015). Verify: callouts/TOC/figures/code styled in light + dark.
3. `posts.preview` (TOOL + REST) returning `{ html, outline, warnings, rendererVersion }` + the shared validator. Verify on dev with `dev:token`: preview a body with a callout/`[[toc]]`/bad-alt image and get correct render + the right warnings, no publish.
4. `posts.format_guide` tool (versioned, preset-aware shape) + `SKILL.md` + onboarding/ConnectAgent loop copy. Verify: a connected agent fetches the guide; `tools/list` description nudges the loop.

## Acceptance / verification
- A post using `> [!NOTE]`, `[[toc]]`, and a captioned image renders identically on public blog, dashboard preview, and `posts.preview` (fixture parity test).
- XSS/safety: `<script>`, `javascript:` links, raw HTML, event handlers render inert (regression of the prior `safeHref` guarantees via the sanitize schema).
- `posts.preview` returns `{ html, outline, warnings, rendererVersion }`; validator emits the right non-fatal warnings; publish is never blocked by warnings.
- `pnpm -r typecheck` + `lint` + `public:audit` green; no em-dash; Worker bundle delta measured + acceptable.
- End-to-end on dev (deploy + `dev:token`): publish a post with components, confirm it renders live; preview matches.

## Out of scope (v1)
- Syntax highlighting (Shiki) - measured fast-follow (baseline code UX required now).
- MDX / executable components.
- Theme/preset SWITCHING + audience capture - that is 015.
- `:::` container directives; auto-outline TOC / sidebars.

## Open decisions for review
1. Admonition plugin: `remark-github-beta-blockquote-admonitions` vs `rehype-callouts` (decide on bundle + control during impl).
2. Shiki timing: confirmed fast-follow (v1 ships baseline code UX). OK?
(RESOLVED since draft: TOC = explicit `[[toc]]`; `posts.preview` return = `{ html, outline, warnings, rendererVersion }`; `format_guide` = versioned preset-aware tool.)
