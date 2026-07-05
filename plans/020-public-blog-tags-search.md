# 020 - Public blog tag pages + search

> **SUPERSEDED** by `docs/url-architecture-decision.md` (2026-07-05): multi-tenant path-mode (`/blog/<site-slug>/*`) is removed; public blogs are host-only. The `/blog/:siteSlug` routes, `basePath` abstraction, and `/blog/demo/...` e2e references below are historical — the tag/search feature now serves at the host root (`/tag/:tag`, `/?q=`) via the host-mode loaders.

Status: DONE - shipped to dev 2026-06-21 (worker `8fc951c4`). Built via parallel subagents (DataAndLoaders + ComponentUI in wave 1 on a pinned loader-data `listing` seam; Routes in wave 2). Search = `LIKE` over title/excerpt/tags/body (find-the-article, not a search engine; FTS5 deferred). Gates green (typecheck/lint/audit/build; 36 node + 17 isolation tests incl. 10 new); verified e2e on dev (tag pages/chips/404, body-term search, `noindex`, empty state) plus landing + path-mode blog-index regression. Surfaced + wired the previously-dead host-mode (`*ByHost`) public-blog routes. Roadmap item #3.

## Why
The public blog is the product's actual output, and 015/016/018 invested heavily in how a single post renders - but the blog as a *site* is bare: posts carry tags (`posts.tags_json`) that are not navigable, and there is no way for a reader to search a blog. Both primitives already exist server-side (tags are stored + exported in front-matter; the dashboard/agent `listPosts` already does a `LIKE` search), so this is mostly wiring the public surface. Reader-facing discoverability matters for launch.

## Current state (verified)
- Routes `apps/web-next/src/routes/blog/$siteSlug/`: `index.tsx`, `$postSlug.tsx`, `llms[.]txt.ts`. Path mode `/blog/:siteSlug[/:postSlug]`; subdomain mode resolves via `resolveSite(request)` by Host. No tag/search route.
- Data `apps/web-next/src/server/public-blog-data.ts`: `listPublishedPosts(siteId)` returns all published posts (DESC), no filter. `SiteRow`/`PostRow` carry `tags_json`.
- Render `PublicBlogPages.tsx`: index cards do NOT show tags; the post page has no tag links; no search box.
- Search: only the dashboard/agent `listPosts` (`LIKE %q%` over title/slug/excerpt). No public search, no FTS5.

## Decisions (recommended; confirm at sign-off)
- SEARCH v1 = `LIKE %q%` over title + excerpt + tags AND the post body (`content_markdown`). This DOES search post content (the point of search) - it just lacks relevance ranking and tokenization (substring match, results ordered by date). NOTE this corrects an earlier call: I had said FTS5 was the "zero-infra boring-first" option, but FTS5 is NOT zero-cost - it needs an FTS virtual table + INSERT/UPDATE/DELETE sync triggers + a migration + query-syntax escaping. The genuinely-minimal option that still searches the body is LIKE-over-body (one query function, no migration, no triggers). What we give up vs FTS5: bm25 relevance ranking, word-tokenization (substring not word-boundary), and an index (LIKE is a full scan - fine at blog scale, slow at thousands of posts). FTS5 is the explicit upgrade when ranking or scale demands it. NO AI.
- TAG PAGES are indexable (self-canonical) when non-empty; an empty/unknown tag returns the not-found view (never a thin indexable page).
- SEARCH RESULTS page is `noindex` (standard SEO - never index query-parameter pages).
- SITEMAP is OUT OF SCOPE for v1 (separate concern; add later if SEO needs it).

## Phase A - Tag pages
1. `public-blog-data.ts`: add `listPublishedPostsByTag(siteId, tag)` - same SELECT as `listPublishedPosts` plus `AND EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value = ?)`. Cap tag length; reject empty.
2. Route `routes/blog/$siteSlug/tag/$tag.tsx` (path mode) + ensure the subdomain resolver routes `/tag/:tag` (via the same `basePath` abstraction the index/post use). Loader resolves site -> `listPublishedPostsByTag` -> reuse the index list view with a "Posts tagged `<tag>`" header; empty -> `PublicBlogNotFound`.
3. `PublicBlogPages.tsx` + `public-blog.module.css`: render clickable tag chips on index cards AND on the post page, each linking to the tag page (`<basePath>/tag/<encoded>`). Theme-aware (`data-vc-theme`), uses the existing `--vc-*` tokens; chips are quiet (not green - green stays the rare accent).
4. SEO: tag page sets canonical to the tag URL, indexable per the gate; title "Posts tagged `<tag>` - `<site>`".

## Phase B - Public search
1. `public-blog-data.ts`: add `searchPublishedPosts(siteId, q)` - `LIKE %q%` over title + excerpt + `content_markdown` (body) + a `json_each` tag match, published-only, DESC, bounded LIMIT. Trim + length-cap `q` (e.g. <= 100 chars); empty `q` -> redirect to the index. Escape LIKE wildcards (`%`/`_`) in `q` so they are literal.
2. Index view: a small search form (GET `?q=`) in the public header/top of the index. Submitting renders the list filtered by `searchPublishedPosts`, with a "Results for `<q>`" header + an empty state; the results view is `noindex`.
3. Works in both path and subdomain modes (form action targets the current `basePath`).

## Cross-cutting
- Reuse ONE list-rendering view for index / tag / search results (no fork).
- Bounded + sanitized inputs (tag + query length caps; `encodeURIComponent` on tag links; the renderer already escapes).
- When edge caching goes live: tag pages are cacheable + purged on publish/update/archive like the index (search results are not cached - query-dependent). Pairs with the deferred caching work in `plans/PROD-LAUNCH.md`.
- No schema change. No new dependency. No AI.

## Verification
- Unit: `listPublishedPostsByTag` / `searchPublishedPosts` against the isolation harness (real D1) - tag match via `json_each`, published-only, site-scoped; search LIKE + length cap.
- Dev e2e: seed a couple published posts with tags on `demo_site`; hit `/blog/demo/tag/<tag>` (lists only tagged), `/blog/demo?q=<term>` (filtered + noindex header), tag chips link correctly; empty tag/query -> not-found / index.
- Browser QA: tag chips render + navigate; search box works; both light/dark + across presets.

## Out of scope (v1)
FTS5 ranked/tokenized search (body IS searched in v1 via LIKE; FTS5 adds bm25 ranking + tokenization + an index when scale needs it), tag counts/clouds, multi-tag AND/OR filtering, pagination (add only if a site's post count demands it), sitemap.xml, related-posts.
