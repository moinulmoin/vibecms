# VibeCMS Phase C — tenant identity & newsletter config

Status: SPEC — build after Phase B lands (touches the same components).
Origin: theme audit 2026-07-04. Scope: three small features, all additive.

## §1 Wire logo + favicon into the rendered blog

`sites.logoAssetId` / `sites.faviconAssetId` exist (packages/db schema:32-33)
but the renderer never reads them.
- Header (PublicBlogPages.tsx:74,193): render the logo image (height-capped,
  ~28px) when logoAssetId is set, else the site name as text (current
  behavior). Logo links home. alt = site name.
- Favicon: `<link rel="icon">` from faviconAssetId in the blog shell head;
  absent → no tag (browser default), never a VibeCMS-brand favicon on a
  customer's blog.
- Dashboard upload UI for both if not already present (audit saw columns,
  verify the settings surface; add minimal upload fields if missing, reusing
  the existing media upload path + its size/format limits).

## §2 Newsletter form copy — tenant-configurable

SubscribeForm.tsx copy is hardcoded (:65-76,113). Add per-site settings
(sites table or existing settings JSON — match whichever pattern the
dashboard already uses for site settings):
- `newsletterTitle`, `newsletterDescription`, `newsletterButtonLabel`,
  `newsletterSuccessMessage` — each nullable; null → current defaults.
- Dashboard settings card with the four fields + live preview if cheap.
- Consent line stays platform-controlled (legal text, not tenant text).
- Honest-copy guard: while email delivery is not live, the DEFAULT copy keeps
  saying early-list ("no emails until delivery is live"); tenant overrides are
  tenant's responsibility.

## §3 `{{newsletter}}` in-body placeholder

The renderer has the exact hook pattern already ([[toc]] — markdown.tsx:151).
- New rehype transform (same placement as rehypeTocCollector): a paragraph
  whose entire trimmed content is `{{newsletter}}` → replaced with the
  SubscribeForm component (same instance as end-of-post, same copy settings).
- Max one per post honored (first wins; extras removed with a render warning
  in the existing warnings channel — markdown.tsx already collects warnings).
- When the in-body placeholder is used, SUPPRESS the automatic end-of-post
  form (no double form). Footer/index form unaffected.
- Sanitize allowlist (markdown.tsx:424-459): whatever element the transform
  emits must be allowlisted.
- Unknown `{{...}}` tokens: left as literal text (no token system beyond this
  one — deliberately).

## Test steering (mandatory)

- Placeholder: markdown fixture tests — mid-post replacement, first-wins +
  warning on duplicates, end-of-post suppression flag, literal passthrough of
  unknown tokens, sanitize survival.
- Copy settings: null → defaults; each override renders; consent text
  unoverridable.
- Logo: header renders img when set / text when null; favicon link presence.
- All repo gates green; screenshot the header with logo + an in-body form.

## Out of scope

Email delivery itself, analytics (Phase D), section reordering (rejected for
V1), multi-placeholder token system.
