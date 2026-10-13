# 026 - Redirects, import, and IndexNow

Status: ON HOLD (owner, 2026-10-12). Depends on 022 (base path aware URLs). No migration reserved — slot 0036 is taken by `0036_domains_hostname_claims.sql`; reserve a fresh slot when implementation starts.

## Why

Most AutoSEOPilot customers already have a blog somewhere. Moving it must not lose search
traffic: posts come over in one go, every old URL 301s to the new one, and search engines
hear about new and moved URLs fast.

## Facts (checked 2026-10-12)

IndexNow: key 8–128 chars `[a-zA-Z0-9-]` in a UTF-8 file `{key}.txt`. At the host root, or
anywhere with `keyLocation`, which then limits submissions to URLs under that file's
directory (so `customer.com/blog/{key}.txt` covers `customer.com/blog/*`). Bulk POST JSON
`{host, key, keyLocation, urlList}` to `https://api.indexnow.org/indexnow`, ≤ 10,000 URLs;
200/202 ok, 403 bad key, 422 wrong host, 429 too many. Participating engines share
submissions with each other (Bing, Yandex, Naver, Seznam, Yep). Google does not use IndexNow.

## Design

### 1. Redirects

- Table `site_redirects(id, site_id, from_path, to_target, status_code 301|302|308,
  source manual|import, hits, last_hit_at, created_at, updated_at)`, unique (site_id, from_path).
- `from_path` is relative to the blog base (with 022, `/old-post` means
  `customer.com/blog/old-post`), normalized: leading `/`, no trailing `/` (except root),
  no query, percent-decoding normalized. A trailing `/*` makes it a prefix rule and
  `:splat` in the target receives the rest (`/category/*` → `/tag/:splat`).
- `to_target`: a blog-relative path (base path prefixed on output) or an absolute `https://` URL.
- Served by the public worker **only when a page would 404** (real content always wins),
  after `post_slug_redirects`. Exact match first, then longest prefix. 301 with the same cache
  rules as slug redirects. Hit counter updated with `waitUntil`, at most once per minute per
  rule (in-isolate throttle).
- Loops rejected on write (target resolves to a redirect source). Changes purge the site tag.
- Limits: hosted free 20, paid 5,000; self-host 5,000.
- Surfaces: Settings → Redirects (table, add, delete, CSV import/export, hits);
  MCP `redirects.list` (read), `redirects.create` / `redirects.delete` (scope `sites:write`,
  "Live change: needs explicit owner approval"); REST mirrors.

### 2. Import

- Sources: **WordPress** WXR (`.xml`), **Ghost** JSON export, **Markdown zip** (front matter
  `title, slug, date, tags, description, draft`), **Substack** export zip (`posts.csv` +
  `posts/*.html`), **RSS/Atom URL** (fallback, content as in the feed).
- HTML → Markdown with the unified stack already used by `packages/content`
  (`rehype-parse` → `rehype-remark` → `remark-gfm` → `remark-stringify`); new deps are allowed
  only for `rehype-remark` and a zip reader (`fflate`). Strip scripts/iframes except known
  embeds the renderer supports; keep code blocks with language.
- Flow:
  1. Upload (dashboard, ≤ 50 MB to R2 `imports/{siteId}/{jobId}`) or `sourceUrl` (MCP/REST;
     fetch with size cap). Create `import_jobs(id, site_id, source, status
     parsing|ready|running|done|failed|cancelled, options_json, totals_json, report_json,
     created_by, created_at, updated_at)`.
  2. Parse to `import_items(job_id, source_id, kind post|page, title, slug, status,
     published_at, old_url, payload_r2_key, result post_id|error)`; dry-run report: counts,
     slug conflicts, images found, redirects that will be created, plan limits that will block.
  3. Person/agent confirms with options: `publishMode: drafts|keep` (`keep` publishes items
     that were published in the source, keeping `published_at`), `importImages: true`,
     `createRedirects: true`.
  4. Runner: the minute cron (`scheduled-dispatch.ts`) processes running jobs in chunks under a
     time budget, plus one chunk via `waitUntil` right after confirm. Images download →
     R2 through `uploadAsset` (quota respected; failures keep the remote URL and are reported).
     Idempotent per `(job_id, source_id)`.
  5. For each post whose old path differs from the new one, add a `site_redirects` row
     (`source: import`).
- Plan: dry run free for everyone; running an import needs paid on hosted (free limits are
  5 posts/5 drafts/10 images); self-host unlimited.
- Surfaces: Settings → Import (upload → report → confirm → live progress → result with
  per-item links/errors); MCP `import.start({source, sourceUrl | fileAssetId})`,
  `import.get({jobId})`, `import.confirm({jobId, options})` (confirm is a live change when
  `publishMode: keep`), `import.cancel`; REST mirrors.

### 3. IndexNow

- Per-site key (32 hex) in `sites.indexnow_key`, created lazily. The public worker serves
  `{base}/{key}.txt` (text/plain, the key) on the primary location; `keyLocation` is that URL.
- Queue `indexnow_queue(site_id, url, reason, created_at)` filled on publish, published-post
  update, archive/unpublish, slug change (old + new URL), import publish. The minute cron
  flushes per site in one bulk POST (dedupe, ≤ 10,000). 429 → exponential backoff stored on
  the site; 403/422 → mark `indexnow_status` with the error, show in settings.
- Only when the site is indexable (paid hosted or self-host) and the primary host is public
  (not `localhost`, not `*.workers.dev`). Settings toggle (default on). Activity log:
  "Told search engines about 3 updated posts".

## Phases

1. Redirects (migration part 1, serving, dashboard, MCP/REST).
2. IndexNow (key file, queue, cron flush, settings, activity).
3. Import parsers + dry run (pure, heavily unit tested with fixture exports).
4. Import runner, images, redirects from import, dashboard flow, MCP/REST.
5. Docs: moving from WordPress/Ghost/Substack, redirects, IndexNow.

## Verification

- Unit: path normalization, prefix + splat, loop detection, each parser on fixture exports
  (including odd ones: WP shortcodes, Ghost cards, Substack footnotes), HTML→MD fidelity.
- Worker tests: redirect only on 404, proxied base path prefixing, limits per plan; import job
  lifecycle, idempotent re-run, chunked runner; IndexNow queue dedupe, payload shape, backoff
  (fetch mocked).
- Dev: import a real WordPress export into a basedui.dev site; spot-check 10 posts, images
  and redirects.
