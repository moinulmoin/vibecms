# Design

Visual system for VibeCMS (`apps/web`). Captured from the shipping code
(`src/styles.css`, `src/presets.css`, landing + dashboard primitives). The brand
is **locked**: dark dev-tool / terminal identity, monochrome neutrals + a rare
green accent, the Space Grotesk / Hanken Grotesk / JetBrains Mono trio. Elevate
within this identity; do not swap fonts or drift maximalist. See `PRODUCT.md` for
the why.

## Theme

Dark-first dev tool. The marketing landing renders dark (terminal aesthetic);
the app respects system preference with explicit `.light` / `.dark` overrides and
a `prefers-color-scheme` fallback. Tokens are OKLCH throughout, defined as raw
`--*` custom properties and surfaced to Tailwind v4 via `@theme inline` (e.g.
`bg-background`, `text-brand-bright`, `bg-vc-bg`).

Color strategy: **Restrained** - monochrome (zero-chroma) neutrals carry the
surface; one green brand color is the only saturated hue, used at ~8% for accents
only. Never large saturated green panels.

## Color

### Brand accent (the only saturated hue)

- `--brand-bright` - `oklch(0.8107 0.1705 152.72)` (dark) / `oklch(0.7423 0.1585 154.53)` (light). The green. ≈ `#80e541` mark / `#57e08a` system green.
- `--brand-bright-foreground` - `oklch(0.1823 0.0294 157.92)`. Near-black ink for text on green.
- `--glow-primary` - translucent brand for ambient glows (`Glow` primitive, radial blur).
- Selection - brand at 28% alpha. Focus ring `--ring` tracks the brand.

**Usage rule:** green is earned, never decorative - LIVE dots, active states,
primary CTA, checkmarks, inline code/cursor, links. Prominence comes from size +
placement, not from flooding color.

### Dark (primary surface)

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `oklch(0.1326 0.0064 244.3)` | App / page bg (faint cool tint) |
| `--foreground` | `oklch(0.936 0.008 155)` | Body ink (faint green tint) |
| `--card` / `--popover` | `oklch(0.1886 0.01 172.93)` | Raised surfaces |
| `--secondary` / `--muted` | `oklch(0.22 0.012 168)` | Quiet fills |
| `--muted-foreground` | `oklch(0.72 0.014 155)` | Secondary text - verify ≥4.5:1 |
| `--accent` | `oklch(0.28 0.055 152)` | Hover / active green-tinted fill |
| `--border` | `oklch(0.47 0.014 168)` | Borders |
| `--destructive` | `oklch(0.54 0.2 25)` | Errors / danger |
| `--sidebar` | `oklch(0.165 0.008 244)` | Dashboard sidebar |

Surface helpers: `--hairline` (`oklch(1 0 0 / 0.12)`), `--surface-glass` /
`--surface-glass-strong`, `--surface-panel-from/to`, `--dot-grid-fill`.

### Light

Monochrome zero-chroma neutrals: bg `oklch(0.985 0 0)`, ink `oklch(0.18 0 0)`,
card `oklch(1 0 0)`, border `oklch(0.9 0 0)`. Primary is a deep green
`oklch(0.32 0.095 152)`. Hairline/dot-grid use black alpha.

### Blog templates / presets (user-selectable, `presets.css`)

These are the **blog themes a VibeCMS user picks for their own published blog** -
a product feature, not app chrome. Each preset is a full token vocabulary
(`--vc-*`, ~43 tokens × light/dark) selected via `[data-vc-theme]` (`minimal`, …)
in `presets.css` + `vc-rich-content.css`, applied to rendered post content.
Surfaced to Tailwind as `vc-bg`, `vc-fg`, `vc-accent`, `vc-border`, etc. Covers
surface, callouts, code, quote, figure, type, spacing.

This token set is **deliberately decoupled** from the VibeCMS app/landing tokens
above: the user's blog should look like *their* brand, not like VibeCMS. When
designing app chrome use the `--*` / `--color-*` tokens; when designing or adding
a blog template, work in the `--vc-*` set. Adding a new preset = a new
`[data-vc-theme]` block here (a shippable product surface in its own right).

## Typography

Three locked families (variable woff2, `font-display: swap`, all preloaded):

- **`--font-display`** - Space Grotesk. Headings / display.
- **`--font-sans`** - Hanken Grotesk. Body (default on `body`). Feature settings `cv11`, `ss01`.
- **`--font-mono`** - JetBrains Mono. Code, terminal UI, eyebrows, pills, tokens.

Geist / Geist Mono are also loaded (rich-content presets). Mono is core identity
here (a literal terminal product), not costume.

Scale: fluid `clamp()` for headings, `text-wrap: balance` on display. Light type
on dark gets extra line-height. Cap prose at 65–75ch.

## Components

Landing primitives (`components/landing/primitives.tsx`):

- **`SectionShell`** - `max-w-[1200px]`, `px-5 sm:px-7`, `py-16 md:py-[110px]`. Section rhythm.
- **`MonoEyebrow`** - mono uppercase `// label` kicker. A **deliberate, named brand system** (terminal comment), not the banned generic eyebrow - keep this intentional, don't sprinkle it on every section by reflex.
- **`Pill`** - rounded mono micro-label with optional pulsing brand dot (LIVE/status).
- **`GlassCard`** - subtle glass surface (inset hairline + deep shadow + glass gradient). Use sparingly; glass is purposeful, not default.
- **`GreenCard`** - green gradient surface. The rare deliberate green fill - reserve for the single highest-emphasis moment.
- **`DotGrid`** / **`Glow`** - ambient background texture (radial dot mask, blurred brand glow).

Dashboard primitives live in `components/dashboard/DashboardPrimitives.tsx`.
Radius scale anchored at `--radius: 0.9375rem` (`radius-sm`…`radius-2xl`).
Cards only wrap genuinely interactive/bounded things - no decorative cards, no
nesting (per PRODUCT.md "just enough").

## Layout

Centered `max-w-[1200px]` shell, fluid horizontal padding, generous vertical
section rhythm (`py-16` → `~110px` on desktop). Landing scroll anchors:
`#features`, `#agents`, `#pricing`, `#faq` with `scroll-margin-top`. Flexbox for
1D, Grid for 2D; responsive grids via `repeat(auto-fit, minmax(…, 1fr))`.

## Motion

Tokenized: durations `--duration-fast/base/slow` (120/180/260ms); eases
`--ease-standard` `cubic-bezier(0.2,0,0,1)`, `--ease-emphasized`
`cubic-bezier(0.16,1,0.3,1)`, `--ease-exit`. Ease-out, no bounce.

Named keyframes: `vc-float` / `vc-float-slow` (ambient), `vc-blink` (cursor),
`vc-pulse` (status dot), `vc-reveal` (staggered entrance via `[data-reveal]` +
`data-d="1..5"` delays). `tw-animate-css` available.

**Reduced motion:** `@media (prefers-reduced-motion: reduce)` neutralizes all
animation and forces `[data-reveal]` visible - every new animation must stay
reduced-motion safe, and reveals must enhance already-visible content.

## Accessibility

WCAG 2.1 AA (see PRODUCT.md). `:focus-visible` → 2px brand ring, 2px offset.
Verify `--muted-foreground` on dark surfaces hits ≥4.5:1 for body, ≥3:1 for large.
Placeholder text needs 4.5:1 too.
