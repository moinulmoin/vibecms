# 018 - Theme presets v2: structural layouts + bounded per-post presentation

Status: DONE - shipped to dev 2026-06-20 (worker `f8d6d5eb`). Built via parallel subagents (contract keystone -> render/format_guide/dashboard consumers); Reviewer + Oracle GO-WITH-CHANGES with all fixes folded (createPostOp presentation P1, previewPostOp single-parse P1, handleSave null semantics, feature-hero empty-state guard, the RuntimeEnv/workers-types decouple via a `@vc/config/runtime` subpath, DTO enum bounds). Gates green (typecheck/lint/audit/build + 36 vitest); verified end-to-end on dev (agent create persists presentation; preview resolve/clamp/surface; essay drop-cap + feature structural render via browser QA). Deferred follow-ups: essay drop cap on image-first paragraphs, schema-safe presentation decode, CLI presentation flags. DEPENDS ON 015 + 016.

## Goal
Let theme presets differ by page LAYOUT/STRUCTURE, not only typography/color, and let post authors (agents and humans) declare a small amount of BOUNDED layout INTENT per post that the owner-selected preset interprets into structure. Agents author semantic Markdown and SELECT among allowed options; they never inject layout structure, classes, or HTML.

## Why / context
015 made a preset a `--vc-*` token skin over ONE shared DOM, so presets differ only in fonts/palette/density and look samey on a thin post. The user wants real structural variety (essay measure + drop cap, feature hero, a table-of-contents region) and asked whether agents should decide layout. Decision (with the user): NO - separation of concerns.
- Owner picks the preset = blog-wide visual identity AND structural character (consistency, brand, safety).
- Agent writes semantic Markdown (content + logical structure) and declares bounded intent.
- Preset interprets intent into structure. Same model as Astro/Fumadocs/Hugo: the theme defines the allowed layouts; front-matter only SELECTS among them. We adopt the pattern, not the file-based transport.

## Keystone decision: a typed `presentation` field, NOT embedded YAML front-matter
Confirmed by three independent lines (advisory + Librarian source research + pipeline map):
1. VibeCMS is API/MCP-authored, not file-authored. `createPostRequestSchema` is already `.strict()` with typed fields (`seoTitle`, `seoDescription`, `tags`) and `contentMarkdown` as a PURE body. Layout intent is just another typed field - reusing the existing convention, not adding a second.
2. Embedded YAML would force agents to string-concat YAML+body, require re-parsing Markdown to validate metadata, and complicate the (currently double-render) `previewPostOp`.
3. `buildPostMarkdown` (apps/web-next/src/server/public-blog.ts) ALREADY emits outbound YAML front-matter for `.md`/Accept-markdown export; author-embedded front-matter would nest/duplicate. So embedded is rejected. No YAML parser / remark-frontmatter dependency is added.

## Current state (grounded)
- Post input: `createPostRequestSchema`/`updatePostRequestSchema`/`previewPostRequestSchema` are `.strict()`; single `contentMarkdown`; no metadata/layout field. Core `createPostInput`/`updatePostInput` in packages/validators mirror this.
- Storage: `posts` + `post_versions` have `content_markdown` + scalar SEO/tags; NO metadata/layout column. Core `Post` has scalars only.
- Renderer (apps/web-next/src/lib/markdown.tsx): `renderRichContent() -> { node, outline, warnings }`; no front-matter handling; `RichContentFrame` wraps the body with `data-rich-content` + `data-vc-theme` (+ optional `data-vc-mode`). `RENDERER_VERSION='1'`.
- Public render (PublicBlogPages.tsx): `data-vc-theme` on the page root; `PublicBlogPostView` renders ONE single-column article; `MarkdownBody` calls `renderRichContent(source)` and DISCARDS `outline`.
- `posts.preview` (previewPostOp) renders TWICE (`renderRichContentToHtml` + `renderRichContent`) - a parity-drift surface.
- Presets (packages/config THEME_PRESETS): token/guidance fields only; no structural-layout capability.
- Dashboard `MarkdownEditor` preview renders `RichContentFrame` only (no preset/presentation wrapper).

## Architecture (Oracle-reviewed, v1 tightened)

### Data model - the `presentation` intent (cut down from the brief)
```ts
// bounded, strict; null = reset to active preset default; omitted-on-update = preserve
presentation?: {
  layout?: 'standard' | 'feature' | 'essay'
  toc?: boolean
} | null
```
- `layout` is the DOMINANT archetype bundle: hero treatment, reading measure, drop cap, and page rhythm all DERIVE from `(preset, layout)`. We do NOT expose independent `width` (preset/CSS design policy) or a `hero` enum (`split` is product-specific responsive work; `none`/`cover` derive from layout + whether a cover asset exists) in v1. This avoids a precedence engine of conflicting knobs and keeps outcomes predictable for agents.
- `toc` requests a table-of-contents region; the preset decides whether/how it renders (see TOC below).
- Carried as a new typed field on the create/update/preview request schemas (api-contract), `createPostInput`/`updatePostInput` (validators), `Post` (core), and the DTOs.
- Storage: `presentation_json TEXT` (nullable) on `posts` AND `post_versions`. We store the REQUESTED intent (not the resolved output) so behavior survives a later preset change and version restore is faithful. null = preset default.

### Preset capability + bounded resolution
`ThemePreset` (packages/config) gains a `layout` capability:
```ts
layout: {
  default: { layout: PresentationLayout; toc: boolean }
  supportedLayouts: PresentationLayout[]   // subset the preset renders
  supportsToc: boolean
}
```
`resolvePresentation(presetId, requested) -> { requested, resolved, warnings: string[] }`:
- clamps `requested.layout` to `supportedLayouts` (else preset default) and `requested.toc` to `supportsToc` (else false);
- never throws - unsupported values GRACEFULLY DEGRADE to the preset default (so old posts never break when a site changes presets);
- emits a `warning` per clamp (e.g. "layout 'essay' is not supported by preset 'technical'; using 'standard'") so the choice is VISIBLE, not silent.

v1 per-preset matrix (reduced per Oracle):
- minimal: `supportedLayouts: ['standard']`, default standard, `supportsToc: false`. Stays boring (it is the safe default).
- editorial: `['standard','essay']`, default essay; essay = narrow measure + conservative drop cap (desktop-friendly) + figure-forward; toc as a simple inline/top block.
- technical: `['standard']`, default standard, `supportsToc: true`; toc renders as a simple page-level BLOCK above content (NOT a sticky sidebar in v1). Denser prose.
- product: `['standard','feature']`, default feature; feature = full-width cover HERO + title treatment; NO split hero, NO "CTA-emphasized close" (the renderer cannot reliably know the CTA paragraph - deferred).

### Shared presented-post layer (parity keystone)
Add `PresentedPostArticle({ renderResult, preset, presentation, post?, coverAsset? })` that turns ONE render result into the structural tree: hero/title/cover treatment, optional TOC block (from the renderer's existing `outline`), drop-cap + measure via a `data-vc-layout="<resolved layout>"` attribute on the article root, then the unchanged `RichContentFrame` body. The Markdown body DOM stays identical (016 contract); structure is added AROUND it.
- Public SSR (`PublicBlogPostView`), `posts.preview` HTML serialization, AND the dashboard editor preview ALL render through this one component, so preview == public == editor is structurally guaranteed (not just token-guaranteed).

### Single-parse preview refactor (mandated)
`previewPostOp` must parse ONCE: `renderRichContent(md) -> { node, outline, warnings }`, `resolvePresentation(...)`, build `PresentedPostArticle`, then `renderToStaticMarkup` that same tree for HTML. No second parse. Returns `{ html, outline, warnings, rendererVersion, requestedPresentation, resolvedPresentation, presentationWarnings }`.

### Table of contents (the main pitfall)
The renderer already replaces inline `[[toc]]` and collects `outline`. v1: `presentation.toc:true` renders a simple page-level TOC block (above content) from `outline`; it does NOT ship a sticky sidebar (sidebar = desktop responsive cost + grid change + a deferred hardening pass). `posts.preview` and the validator emit a warning when `presentation.toc===true` AND the body also contains `[[toc]]` (duplicate-TOC), and `format_guide` instructs agents not to combine them. Suppressing inline `[[toc]]` would require body-DOM variation and is explicitly deferred.

### Agent fidelity
- `posts.format_guide` gains a structured `presentationOptions` field: the active preset's `supportedLayouts`, `default`, `supportsToc`, and notes (incl. the do-not-combine-with-`[[toc]]` rule). Bump `GUIDE_VERSION`.
- `posts.preview` returns the requested AND resolved presentation + warnings, so an agent sees exactly what it will get.

### Dashboard (humans author too)
Post editor gains presentation controls (a `layout` select + a `toc` toggle) bounded to the active preset's supported options; the existing in-editor live preview renders through `PresentedPostArticle` so it matches public.

### Migration / export / safety
- Migration `0010_post_presentation.sql`: `ALTER TABLE posts ADD COLUMN presentation_json TEXT;` + same for `post_versions`. Backfill = null (preset default). Non-breaking.
- Export: `.md` export serializes a non-null `presentation` into the GENERATED, namespaced front-matter (e.g. a `vibecms:` key), generated-only - never parsed back from authored `contentMarkdown`.
- Safety: strict Zod (reject unknown keys + invalid enums at the boundary); resolved presentation maps ONLY to a fixed set of `data-vc-layout` tokens + classes the CSS targets - never raw class/component/HTML injection; per-preset clamp; bounded payload; no YAML/parser surface.

## Scope (files)
- packages/api-contract: `requests.ts` (presentation on create/update/preview, nullable reset), `dto.ts` (presentation on postDto/postVersionDto; resolved presentation + warnings on previewPostDto; presentationOptions on formatGuideDto).
- packages/validators: `post.ts` (presentation schema + allowlist on createPostInput/updatePostInput).
- packages/core: `types.ts` (Post.presentation), `commands/posts.ts` (thread + reset semantics).
- packages/db: migration `0010_post_presentation.sql`; `schema.ts` (presentation_json on posts + post_versions); `repositories/posts.ts` (row types, selects, insert/update, version rows, decode with the shared schema).
- packages/config: `ThemePreset.layout` capability + per-preset values + `resolvePresentation`.
- apps/web-next/src/lib/markdown.tsx: keep `renderRichContent` single-parse; the presented layer consumes its result (no body-DOM change).
- apps/web-next/src/components: new `PresentedPostArticle`; `PublicBlogPages.tsx` (use it; pass resolved presentation; `data-vc-layout`); dashboard `MarkdownEditor`/editor (presentation controls + preview through the shared layer).
- apps/web-next/src/components/public-blog.module.css: structural wrappers keyed off `data-vc-layout` (essay measure + drop cap, feature hero, TOC block); preset token CSS (presets.css) unchanged.
- apps/web-next/src/server: `operations.ts` (createPostOp/updatePostOp thread presentation; previewPostOp single-parse + resolved output), `format-guide.ts` (presentationOptions), `public-blog-data.ts`/`public-blog.ts` (SELECT presentation_json; export serialization), `mcp-dispatch.ts`/`api/app.ts` (pass-through; no route reorder).

## Phases (each gated by manual dev verification; build only after sign-off)
1. Contract + storage: presentation through api-contract / validators / core / db (posts + post_versions + repo) / DTOs + migration 0010, with `null` reset + omitted-preserve semantics.
2. Preset capability + `resolvePresentation` (+ warnings + resolved DTO shape).
3. Shared `PresentedPostArticle` abstraction + single-parse `previewPostOp` refactor.
4. Public structural wrappers + CSS for the reduced v1 matrix (editorial essay/drop-cap, product feature hero, technical TOC block, minimal standard).
5. Agent fidelity: `format_guide.presentationOptions` + `posts.preview` resolved presentation/warnings.
6. Dashboard editor controls + preview parity.
7. Verify: gates + dev e2e + browser QA across preset x supported layout/toc, duplicate-`[[toc]]` warning, version restore, `.md` export round-trip.

## Acceptance / verification
- A post's `presentation` persists, version-restores faithfully (raw requested intent), and `null` resets to preset default.
- `resolvePresentation` clamps unsupported values to the preset default and surfaces warnings; nothing throws.
- Each preset renders its supported layouts; editorial essay shows narrow measure + drop cap; product feature shows a cover hero; technical `toc:true` shows a TOC block; minimal stays standard.
- preview == public == editor for the same `(content, preset, presentation)` via the shared presented layer.
- `format_guide` exposes the active preset's presentation options; an agent that requests an unsupported layout sees the degraded result + warning in `posts.preview`.
- `.md` export serializes non-null presentation under the namespaced key; authored `contentMarkdown` is never parsed for front-matter.
- Gates green (typecheck/lint/audit/build, zero em-dash); migration applied on dev.

## Out of scope (v1)
- Independent `width` knob and a `hero` enum / `hero: split`.
- Sticky sidebar TOC (deferred hardening pass; v1 is a top TOC block).
- Product "CTA-emphasized close" (needs an explicit component/field).
- Site-level presentation defaults (per-post + preset default only).
- Any renderer option that suppresses or rewrites body-level `[[toc]]`.
- Embedded front-matter authoring; a free page-builder / agent-injected structure.
- Newsletter send (017) - ON HOLD.

## Open decisions (none blocking; for sign-off)
- Exact essay measure + drop-cap styling per preset (CSS detail, settled at build).
- TOC block placement (above content vs after the lead) - default above; revisit in QA.
- Whether `format_guide.presentationOptions` is a new typed DTO field (preferred) vs folded into guidance text (decided: typed field).
