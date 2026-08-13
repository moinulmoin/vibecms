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
2. **Editor as review surface** — DONE. Exact full-page preview (ca591ba):
   shared `PublicPageChrome`/`SubscribeBlock`, site identity in the payload,
   inert preview. Review strip (9a60064): version, live/unpublished/draft/
   archived state via tested `editorLiveState`, last-saved actor + time,
   open-live link, publish action next to the state it acts on. Review-before-
   publish (8c27065): strip's Review changes opens the pinned-vs-tip diff.
   DEFERRED (explicit): mobile Preview/Markdown/Settings tabs — the stacked
   layout recomposes correctly today; a tab system needs shared mode state
   across panels and deserves its own pass with mobile QA.
3. **Dashboard composition/typeset** — DONE (b6c5877 + f93cd66): 1200px canvas,
   optional kicker with echo kickers removed, editor status dedup. Overview is
   decisions-first (status → Needs review drafts → latest publish → activity →
   posts → stats → usage); posts list has the By column (actor via user/api-key
   join, "you"/"agent" guards); one read-model query replaced the N+1 version
   lookups.
4. **Voice pass** — DONE (7fb1549). Landing clichés removed ("Everything one
   serious blog needs", "Live in seconds", "served fast"); "serious blog" kept
   only in pricing; security claim unified ("it never sees your login");
   BRAND.description = "The CMS your agents publish into…" everywhere (config,
   manifests, README); product llms.txt gained a For agents section (MCP
   endpoint, per-post Markdown, tenant llms.txt); overview badge now says
   "Free plan" (was false-urgency "Subscribe to publish"). MCP instructions
   ("one calm blog") and dashboard empty states were already in-voice —
   untouched.
5. **Dashboard operating polish** — DEPLOYED TO DEVELOPMENT. The shared shell
   now uses the 1200px operating canvas, a compact terminal breadcrumb, and a
   clearer active navigation marker. Shared blocks distinguish bounded
   interactive surfaces from flat work surfaces; metric groups and data rows
   read as continuous ruled systems instead of repeated cards. Page kickers
   were removed, page-title hierarchy was strengthened, and Overview, Posts,
   Media, Connect, Activity, Analytics, Billing, Settings, and the editor rail
   were aligned to the same density and responsive rhythm.

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
Purged 2026-08-05 via forced revalidation. Root-cause review (2026-08-06): NOT
reproducible under current routing — `isMarketingHost` classifies the zone apex
before tenant resolution (unit-tested), tenant 404s carry no cacheable headers,
and custom-hostname reassignment/removal already purges by host. The poisoned
entry predated the marketing-host check. No code change needed; closed.
