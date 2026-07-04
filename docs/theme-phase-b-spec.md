# VibeCMS Phase B — default theme to "clean, minimum, a joy to read"

Status: SPEC — awaiting founder strike/bless on the two marked options, then build.
Origin: theme audit 2026-07-04 (file:line refs verified against main @ cc76477).
North star (founder): minimum, clean, good enough for a human to ENJOY reading.
Nothing clever, nothing complex. Whitespace does the work.

Architecture note that shapes everything below: presets (`presets.css`) are
token sheets only; ALL fixes in §1–§8 live in the shared layer
(`public-blog.module.css`, `vc-rich-content.css`, `PublicBlogPages.tsx`,
`PresentedPostArticle.tsx`) — so every fix lands on all four presets at once.
§9 is the only per-preset work and it is token values only.

## §1 Horizontal-divider purge (founder-locked)

Remove every long horizontal rule; separation comes from the spacing scale.
- Header `border-bottom` — public-blog.module.css:16. Header separates by
  padding + the title's own weight. Nothing else.
- Post-card `border-bottom` — :39. Cards separate by a larger gap
  (≈3rem between entries); no line.
- Search input `border-bottom` underline — :262,266 → a quiet filled input
  (subtle bg tint, radius, no border lines).
- ToC `li + li` top borders — vc-rich-content.css:206-207 → plain list,
  comfortable line-height, no rules.
- Markdown `hr` (:227-231): keep it semantically (authors type `---`) but
  render as a centered short mark (e.g. a 3-dot or 2ch-wide hairline at 30%
  opacity) — an intentional pause, not a wall-to-wall line.
- Footer: if any full-width rule exists above it, same treatment — padding only.

## §2 Post masthead (the biggest visible lift)

PresentedPostArticle.tsx:33-69. New anatomy, all layouts:
1. Title (see §7 for softened type).
2. ONE quiet meta line: `Mar 4, 2026 · Updated Jul 2, 2026 · 6 min read`
   — middle-dot separated, muted-but-AA color (§8), no icons, no labels.
   Updated segment only when the 24h rule fires (already built in Phase A).
3. Tags move from below-the-subscribe-form (PublicBlogPages.tsx:209) to a
   small quiet row under the meta line — sentence-case text links, comma or
   dot separated, NOT tracked-mono pill chips (chips die in §6).
4. Cover image after the masthead (feature layout keeps cover-first).
Reading time: word count of content_markdown / 225 wpm, rounded up, computed
at render/read-model level (no DB column). "1 min read" floor.

## §3 Table of contents → sticky rail

Replace the boxed top-of-article card (PresentedPostArticle.tsx:70-83,
.tocBlock public-blog.module.css:426-443):
- ≥1100px: sticky right rail ("On this page", sentence case — the uppercase
  ::before eyebrow at :440 dies), plain text links, active-section highlight
  optional (only if trivially cheap — no scroll-spy library).
- <1100px: native `<details>` ("On this page") collapsed by default, above
  the article. No box, no border.
- Render only when outline has ≥3 entries (today any 1 heading renders it).
- Presets without `supportsToc` unchanged. The separate inline `[[toc]]`
  marker keeps working (renders the same list inline, unboxed).

## §4 Index page, kept minimal

PublicBlogPages.tsx:127-154. Stays a single-column list (founder: nothing
complex) — but breathes:
- No card borders (§1). Entry = title (larger, real hierarchy) + one-line
  excerpt + small date · read-time line. ~3rem between entries.
- Drop any hover-card chrome; hover = title color shift only.
- No featured/hero variants, no grids. (Deliberately rejected: uniform card
  grid AND magazine layouts — both are complexity without reading value.)

## §5 Callouts & blockquotes — MARKED OPTION A (Claude recommendation)

vc-rich-content.css:145-183 (callout left bars + uppercase labels),
public-blog.module.css:208 (blockquote 3px left bar).
- RECOMMENDATION: callouts → soft tinted background, radius, small inline
  icon + sentence-case label ("Note", "Warning"), NO left border. Blockquote
  → indented italic-free prose with a slightly larger quiet quote mark or
  just deeper indent + muted color, no bar.
- Founder may STRIKE this (left bars stay, only §6's uppercase labels fixed).
  Strike/bless before build.

## §6 Eyebrow & chip purge

- Callout label uppercase/tracked — vc-rich-content.css:181-183 → sentence
  case, regular tracking.
- Code-block language badge — :271-273 → lowercase quiet text (`ts`), or
  drop entirely.
- Tag chips tracked-mono pills — public-blog.module.css:297-308 → plain
  sentence-case text links (per §2.3).
- ToC "Contents" eyebrow — dies in §3.

## §7 Type softening — MARKED OPTION B (Claude recommendation)

- Title: line-height 0.96 / letter-spacing −0.07em (public-blog.module.css:
  93-100) → line-height 1.08, letter-spacing −0.025em, clamp max ~56px
  (72px shouts). Add `text-wrap: balance`.
- Essay drop cap (:413-422): RECOMMENDATION remove (templated flourish).
  Founder may strike (keep drop cap).
- Feature-layout measure bug (:380-382): body prose NEVER exceeds
  --vc-prose-measure even when the hero is full-bleed — wrap prose in the
  measured column; only the cover breaks out.

## §8 Contrast to AA (shared rule, per-preset values in §9)

All muted text ≥4.5:1 against its background: dates/excerpts
(public-blog.module.css:48-51,107-113), captions (:238), meta line, ToC
links. Mechanic: darken `--vc-muted-fg` per preset until AA passes on that
preset's `--vc-bg` (verify with a contrast checker, record the pairs in the
PR description).

## §9 The four presets — the only per-preset work

Everything above lands on all four automatically. Per preset, only:
1. `--vc-muted-fg` (and any preset-specific muted tokens) re-tuned to AA (§8).
2. Visual QA pass per preset × light/dark: masthead, index, callouts, ToC,
   code blocks — screenshot each, eyeball for token clashes the shared-layer
   changes may expose (e.g. editorial's serif headings at the new tracking).
3. Fix only what the QA pass surfaces; no per-preset redesigns.
Launch posture: all four ship IF each passes QA; any preset that looks off
gets hidden from the picker for launch rather than polished under pressure
(config: preset list in packages/config). Minimal stays the default.

## Out of scope (Phase C/D, separate specs)

Logo/favicon wiring, newsletter copy settings, {{newsletter}} placeholder,
analytics, email delivery. No preset-builder, no custom colors.

## Test/verify steering (mandatory for the build)

- Reading-time: unit tests (0 words → 1 min floor; 450 words → 2 min;
  boundary at 225).
- ToC gating: 2 headings → no ToC; 3 → ToC. [[toc]] inline still renders.
- Masthead: updated-date rule already tested (Phase A); add render-level
  assertion if a component harness exists, else explicit manual-verify note.
- Visual verification is REQUIRED: run the dev server, screenshot post +
  index pages for all four presets × light/dark (16 shots), attach paths in
  the final answer. A build without screenshots is not done.
- All repo gates green (pnpm -r typecheck; @vc/web test + test:isolation).
