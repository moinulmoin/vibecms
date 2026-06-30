# Agent Guide - apps/web

## Design Context

Before any UI/design work in this app, read these two files - they are the
source of truth:

- **[PRODUCT.md](./PRODUCT.md)** - strategy: register, users, purpose, brand
  personality, anti-references, design principles, accessibility target.
- **[DESIGN.md](./DESIGN.md)** - visual system: OKLCH tokens, color, typography,
  components, layout, motion, the blog-template preset system.

### Non-negotiables

- **Register:** `brand` by default (the marketing landing). Override to
  `product` for dashboard surfaces (`/app`, editor, settings, onboarding). The
  surface in focus decides.
- **Brand is locked.** Dark dev-tool / terminal identity. Fonts are fixed: Space
  Grotesk (display) · Hanken Grotesk (body) · JetBrains Mono (mono). Do not swap
  fonts or drift maximalist - elevate within the identity.
- **Green is earned, never decorative.** `--brand-bright` only at ~8%: LIVE dots,
  active states, primary CTA, checkmarks, inline code/cursor, links. No large
  saturated green panels.
- **Not less, not more - just enough.** No gratuitous borders/dividers; cards
  only wrap genuinely interactive things; never nest cards.
- **Two token sets, don't cross them:** app/landing chrome uses `--*` /
  `--color-*`; user-facing blog templates use `--vc-*` (`presets.css`) so a
  user's blog looks like *their* brand, not vibecms.
- **Accessibility:** WCAG 2.1 AA. Body ≥4.5:1 (verify muted-fg on dark), visible
  focus rings, every animation reduced-motion safe.

These docs are maintained via the `/impeccable` skill (`init` / `document`).
