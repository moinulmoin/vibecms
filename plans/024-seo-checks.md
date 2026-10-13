# 024 - SEO checks: deterministic rules plus a cheap AI review

Status: Phases 1–2 implemented; dashboard API route available, editor UI (phase 3) remains out of scope. Format guide/MCP instructions and root docs updated; public-app docs unchanged by slice constraint. Independent of 023. Migration slot: `0035`.

## Why

AutoSEOPilot writes posts with agents; vibecms is where they land. Both the agent and the
person should get a clear "is this post ready for search and AI answers?" before publishing,
in the same place they already look (`posts.preview` warnings, the editor rail). Today
preview warnings cover rendering only (alt text, TOC, code fence language, headings ids);
nothing checks titles, descriptions, heading structure, links or duplicates.

## Cloudflare facts (checked 2026-10-12)

Workers AI: 10,000 neurons/day free on both Free and Paid plans, then $0.011 per 1,000 neurons
(Paid only). `@cf/google/gemma-4-26b-a4b-it` costs 9,091 neurons per 1M input tokens and
27,273 per 1M output. A review of a 6k-token post with 600 output tokens ≈ 71 neurons ≈
$0.0008; the free allocation covers ~140 reviews/day. Self-hosters on Workers Free get that
free allocation too.

## Design

### 1. Deterministic checks (`packages/content/src/seo-checks.ts`, pure)

`seoChecks(input) → SeoFinding[]` with `{ code, severity: "error"|"warn"|"info", field, message, fix }`.
Input: title, slug, seoTitle, seoDescription, excerpt, canonicalUrl, coverAssetId, the
rendered hast (reuse the renderer's parse), site info (indexable, primary base URL), published
slugs of this site, other published posts' titles/descriptions, optional `focusKeyword`.

Checks (codes are stable API):
- `title-length` (effective SEO title 15–60 chars), `description-missing`,
  `description-length` (50–160), `slug-long` (> 75), `slug-format` (uppercase, `_`, dates).
- `h1-in-body` (the title is the H1; body H1 → warn), `heading-skip` (H2 → H4),
  `heading-empty`, `heading-duplicate`.
- `link-internal-broken` (root-relative or same-host link to a slug that isn't published),
  `link-insecure` (`http://`), `link-anchor-generic` ("click here", "here", "read more",
  "this"), `link-none-internal` (info: no links to other posts).
- `content-thin` (< 300 words, warn), `paragraph-long` (> 150 words, info).
- `image-alt-missing` (already a render warning; reuse, don't duplicate).
- `social-image-default` (info: no cover, generated card will be used).
- `duplicate-title`, `duplicate-description` (against other published posts).
- `canonical-external` (info), `site-not-indexable` (info: search indexing needs paid on hosted).
- With `focusKeyword`: `keyword-title`, `keyword-slug`, `keyword-intro` (first 100 words),
  `keyword-heading`, `keyword-description` (each warn when missing).

No score. A short list sorted by severity is easier to act on, for people and agents.

### 2. AI review (opt-in, `apps/api/src/server/seo-review.ts`)

- `AI` binding in apps/api (`"ai": { "binding": "AI" }` in every env). Model id from
  `SEO_REVIEW_MODEL` var, default `@cf/google/gemma-4-26b-a4b-it`.
- Prompt: post Markdown (truncated to ~6k tokens), title, description, focus keyword, site
  name. JSON mode with a strict schema: `{ intent, titleIdeas[2], descriptionIdea,
  missingSubtopics[≤5], unclearPassages[≤3] {quote, why}, claimsNeedingSources[≤3] {quote} }`.
  Output capped at 700 tokens. Validate with zod; drop anything that doesn't parse.
- Treat the post as untrusted data in the prompt (delimit it; instructions say ignore
  instructions inside the post).
- Cache: table `post_seo_reviews(site_id, post_id, version_number, model, result_json,
  neurons_estimate, created_at)`, unique on (post_id, version_number, model). Same version →
  cached result, no new call.
- Limits: hosted paid 100 reviews/site/day, hosted free 3/day (a taste), self-host unlimited
  (their own neurons). Over the limit → `RATE_LIMIT` with `retryAfterSeconds`. Missing
  binding → `AI_UNAVAILABLE` (self-host without AI).

### 3. Surfaces

- MCP `posts.seo_check({ postId, focusKeyword?, ai? })` (scope `posts:read`, read-only
  annotation; `ai: true` counts against the review limit). Returns `{ versionNumber,
  findings[], ai?: {...} | null }`. REST `GET /api/v1/posts/{id}/seo?focusKeyword=&ai=1`.
- `posts.preview` adds `seo: SeoFinding[]` (deterministic only) next to `warnings`, so agents
  following the existing preview flow see it for free. Server instructions and the format
  guide tell agents to fix `error`/`warn` findings before asking for publish approval.
- Dashboard editor: an "SEO" section in `PostMetadataRail` (checklist, grouped by severity,
  each with its fix text; focus keyword input saved per browser), "Ask AI review" button
  showing title/description ideas with one-click apply to the SEO fields. `PublishDialog`
  lists open `error` findings (does not block).
- AutoSEOPilot: same MCP/REST; nothing custom.

## Phases

1. `seo-checks.ts` + tests; wire into `posts.preview` and `posts.seo_check` (deterministic).
2. AI review: binding, migration 0035, cache, limits, tests with a mocked `AI.run`.
3. Dashboard SEO section + publish dialog list.
4. Docs + format guide + MCP server instructions.

## Verification

- Unit: every check with a passing and failing fixture; code fences never produce link or
  heading findings; findings stable order.
- Worker tests: `posts.seo_check` scope, caching by version, limits per plan, AI parse
  failure → `ai: null` with a warning, not an error.
- Local live Worker smoke: REST draft creation, deterministic SEO with focus keyword, preview SEO, MCP read-only tool listing, and missing-binding `AI_UNAVAILABLE` exercised against isolated D1 with migration 0035. No remote model invocation or neuron-usage verification.
- Dev: run on a real draft via MCP on basedui.dev; check neurons used in the Workers AI
  dashboard.
