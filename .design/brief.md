# vibecms design brief

Canonical sources: `PRODUCT.md` (strategy, brand personality, anti-references) and
`DESIGN.md` (token system, locked fonts). This brief records the current design
program state so every design-mode session starts from evidence, not memory.

## Product identity

Dark dev-tool / terminal identity. Technical, controlled, confident. Users are
developers who let AI agents run their blog while staying owner of record. The
felt promise: **control is visible** — versions, activity, scoped tokens.

## Surface verdicts (2026-08-05, rendered evidence on dev)

- **Landing (`basedui.dev`)** — strongest surface. Terminal hero, live agent
  demo, scoped-token section, pricing, FAQ. Keep; only `voice`-mode copy
  sharpening later. Register: brand.
- **Dashboard (`app.basedui.dev`)** — weakest surface. Clean but generic:
  sparse content stretched wide, oversized form controls, repetitive kickers
  ("Workspace", "Content"), editor preview ≠ real public page. Register:
  product.
- **Public blog themes** — product-truth gap: Minimal/Editorial/Technical/
  Product share ONE token palette (`packages/content/src/styles/presets.css`
  "ONE BASE" contract). Landing advertises "Themes that look designed" — must
  become true.

## Program sequence (agreed with user)

1. **Honest templates** — DONE (d897edf). Four distinct typographic identities;
   per-theme token blocks in presets.css + chrome rules; `data-vc-theme` on the
   article root keeps public SSR and dashboard preview identical.
2. **Editor as review surface** — MOSTLY DONE. Exact full-page preview
   (ca591ba): shared `PublicPageChrome`/`SubscribeBlock`, site identity in the
   payload, inert preview. Review strip (9a60064): version, live/unpublished/
   draft/archived state via tested `editorLiveState`, last-saved actor + time,
   open-live link, publish action moved next to the state it acts on. OPEN:
   version diff surfaced near publish (drawer exists), mobile
   Preview/Markdown/Settings tabs.
3. **Dashboard composition/typeset** — PARTIAL (b6c5877): 1200px canvas,
   optional kicker with echo kickers removed, editor status dedup. OPEN:
   decisions-first overview order, posts list actor column, copy-level typeset.
4. **Voice pass** — copy balance across three audiences: technical (devs),
   non-technical (outcome language), agent-facing (llms.txt, MCP, structured
   truth equivalent to the visual UI).

## Invariants

- Geist / Geist Mono only in app chrome. `--vc-*` tokens for blog templates;
  never cross the two token sets.
- Green is earned (~8%): LIVE dots, active states, primary CTA, checkmarks,
  links.
- No decorative cards, no nested cards, no gradients in product UI.
- WCAG 2.1 AA; every animation reduced-motion safe.
- Human approves publish; no automated prod deploys (`pnpm deploy:prod`
  manual only).

## Known infra note (found during evidence pass)

Dev apex `basedui.dev/` served a cached tenant blog instead of marketing
(edge-cached tenant index, `s-maxage=300 swr=86400`, kept warm by traffic).
Purged 2026-08-05 via forced revalidation. Root fix outstanding: tenant index
responses should not be edge-cacheable on non-canonical hosts.
