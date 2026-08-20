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
   Mobile Write/Preview/Settings tabs shipped later (that "DEFERRED" note was
   stale; corrected in phase 8).
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
6. **Launch finish** — IN PROGRESS. Driven by the Launch UX Review
   (`.design/review-report.md`, 2026-08-15, score 3.0/4.0, no P0). Done and
   committed (26e7167): login/onboarding brand links escape to
   `BRAND.marketingUrl`; `/legal/privacy|terms|support` pages with footer
   Legal group (maker links demoted) and login legal nav; marketing launch
   offer (`LAUNCH_OFFER` in `@vc/config`, pricing module with standard
   $19/$190 anchors, FAQ entry); free-tier disclosure line under the pricing
   CTA (`FREE_TIER`); agent-surface MCP counts corrected (18 with Publisher
   scope / up to 19); FAQ heading "Questions about early access"; launch
   rehearsal refreshed to current pricing/facts. Onboarding progress continuity landed 2026-08-16 (77618c7): a compact
   `OnboardingStepper` rail renders under the connect page header until the
   first post is live, driven by tested `connectOnboardingStep` (existing
   connection/first-post status, no second state machine). P2 batch landed
   2026-08-16 (50e3c1a): disclosure mobile section menu (icon-only <380px,
   Sign in inside it <sm), skip-to-content link, and invisible hit-area
   extensions bringing landing/login/onboarding links and the email input to
   ~44px without visual change. Also in 50e3c1a: GitHub OAuth mirrors the
   existing env-gated Google wiring (`GITHUB_CLIENT_ID/SECRET` worker
   secrets; AuthForm renders one button per enabled provider), and the login
   page gained the restrained `// your agent never sees this login` cue
   (P3 #12). Remaining operator steps (no code): set Google/GitHub worker
   secrets with the `{BETTER_AUTH_URL}/api/auth/callback/{provider}` OAuth
   clients, verify the compact-menu keyboard behavior, and deploy dev. **DESCOPED (user decision, 2026-08-16):** no artificial
   checkout enforcement — no Polar auto-applied
   discounts, no first-100 eligibility counter in billing. The launch offer is
   expressed as the discounted price; Polar products
   are set to the offer price directly. Review finding P1 #1 is satisfied by
   the marketing-side module alone. NAMING (user, 2026-08-17): it is the
   "launch offer", never "founding offer/rate" — renamed end to end (config,
   marketing, FAQ, terms, dashboard, MCP instructions, skills). On a blog's
   first successful publish, both surfaces mention the launch offer once:
   the dashboard upgrade panel carries the offer line, and agent guidance
   (MCP instructions + vibecms-core skill) tells the agent to name the free
   boundary and offer exactly once — never repeated, never tied to task
   quality.
7. **Personalized onboarding** — DESIGN AGREED (2026-08-17), build starting.
   Goal: the journey feels built-for-them without becoming a survey; every
   question must produce a visible payoff ("input → payoff" rule — a question
   that only feeds analytics gets cut). Shape: a short dedicated step between
   setup and connect ("Make it yours"), rail becomes 4 honest beats (Setup →
   Make it yours → Connect agent → First post); everything skippable; each
   field carries a `// used for: …` note. Inputs: agent picker (Claude Code,
   Codex, Cursor, Droid, other MCP), voice seed (2-3 links to their writing,
   stored as-is), pain point free-text ("what made you look for vibecms?" →
   site meta for the founder). Payoffs: connect page pre-loads the chosen
   agent's config and instructions in its dialect, plus a copyable
   personalized SKILL.md block for their blog repo; voice/prompt tailoring
   lands via the existing voice-profile system; publishing focus stays
   generic for now. **Deferred-to-agent model (user direction):** uncompleted
   configuration surfaces as "recommended, not configured" states in the
   dashboard and MCP instructions so the user's agent offers to complete it
   under human approval — we do not build our own fetchers; coding agents
   already fetch URLs natively. Brand-URL fetch / theme-preset
   recommendation: POSTPONED to a later polish phase (heaviest payoff, can be
   agent-triggered). No paywall mid-onboarding: the launch-offer line surfaces
   at the first-live success peak (pull, not interruption). (**Corrected a
   stale "founder rate" mention; the agreed name is launch offer.**)
8. **Editor live preview** — BUILD (2026-08-18, user approved the direction in
   plain terms: "when you type, the page next to your text updates by itself;
   no buttons"). Informed by studying usemarble/marble (local clone +
   marblecms.com): Marble's editor is Tiptap/Novel with bubble menus, slash
   commands, and a metadata/analysis sidebar — rich, but it stores HTML and
   can't round-trip a shared Markdown canonical, so the engine is NOT adopted.
   What transfers: contextual over persistent chrome, the live/always-fresh
   preview, an analysis-as-quiet-stats idea (word count + reading time in the
   write toolbar), and the separate-settings-rail composition. Build: the
   manual Refresh/stale-warning machinery (`isPreviewCurrent` revisions) is
   replaced by a tested debounced `usePostPreviewSync` (~400ms after input
   settles); desktop renders write | exact-public-page | settings rail (rail
   full-width below the split on lg, right column from xl); mobile keeps the
   Write/Preview/Settings tabs, now auto-fresh; the preview stays the shared
   PublicPageChrome/PresentedPostArticle surface, inert to link clicks, and
   the stale phase-2 note about deferred mobile tabs is corrected. Follow-ons
   same day: slash-command block insertion into the textarea (caret-anchored
   menu, /image routes to the alt-text-enforcing media dialog, no H1 — the
   title owns it); posts rows navigate via data-row-key row clicks (Marble
   pattern, guarded against interactive descendants/modifiers); media bulk
   select+delete with optimistic removal, ordered partial-failure rollback,
   and sr-only progress announcements. Hook detail fixed in review: preview
   deps include the post identity so asset-less posts preview on load without
   a keystroke. Copy adjusted for mobile (preview lives in the Preview tab).
   V2 COMPOSITION (2026-08-20, user: the editor page still read too busy):
   adopt Marble's page composition in our skin — one centered 46rem writing
   column, slim sticky bar (back · state signal · Write/Preview switch ·
   settings · Save/Publish), Preview as a full-canvas live mode, settings as
   a right overlay Sheet whose inputs bind to the form via the form
   attribute (portal-safe), mobile rail unchanged. The horizontal settings
   tabs from earlier today were superseded by this Sheet; the user's actual
   ask was horizontal tabs on the MAIN Settings page — still queued. Dark
   --border/--input corrected to near-surface oklch(0.30/0.28) (learned from
   Marble's dark tokens) and DESIGN.md documents the two-tier line rule.

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
