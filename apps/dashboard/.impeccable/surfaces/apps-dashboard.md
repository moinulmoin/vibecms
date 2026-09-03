---
version: 1
slug: "apps-dashboard"
primary_target: "apps/dashboard"
related_targets: []
---

# apps/dashboard — Surface Brief

## Scope & mode
Operate. The logged-in product surface: overview, posts, editor, media, connect,
activity, analytics, subscribers, settings. Marketing landing is a separate
Persuade surface; this brief never applies there.

## Audience & job
Developers/indie hackers running agent-published blogs. They connect an agent
once, then own every post: review, approve, publish, restore. Success = complete
a task in seconds and trust what the system shows (status, versions, counts).

## Direction (2026-08 redesign, shipped)
Dark-first terminal identity, locked Geist trio, green earned at ~8%. The
consistency layer is the product: one `blocks/` primitive vocabulary
(PageHeader/Panel/StatCard/ListRow/StatusBadge/EmptyState/PageSkeleton) carries
every page; two-tier borders (--border components, --hairline rules); flat
bordered panels with NO card shadows; tokenized shadows reserved for overlays
(--shadow-menu/--shadow-overlay); md (768px) is the single layout breakpoint;
mono only for technical chrome, never prose.

Memorable moments: the BlockNote editor (Write/Source/Preview tri-mode,
preset-styled WYSIWYG canvas, markdown stays canonical via the adapter with
drift detection) and the sidebar Light/Dark/System switch completing the
half-wired theme system.

## Constraints
- WCAG 2.1 AA; muted-foreground verified on dark.
- Status vocabulary is closed: success/warning(amber)/error/ink(draft)/muted.
- Newsletter = capture only (delivery roadmap-deferred); copy stays honest.
- Editor storage is markdown only — never block JSON in the DB.

## Unresolved
- BlockNote spellcheck squiggles in canvas (native, accepted for now).
- Editor slash-menu keyboard selection quirks under CDP automation are test
  tooling, not product.
