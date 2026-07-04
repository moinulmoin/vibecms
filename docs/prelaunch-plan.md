# Pre-launch plan (from external architecture review, 2026-07-02/04)

Findings from a full code review (architecture, SEO correctness, ASP-integration surface).
Section A fully implemented: 774d6f3 (JSON-LD, absolute og tags, sitemap lastmod, RSS atom:self, h1 downgrade, updated badge) plus the canonical-override projection fix (canonical_url now reaches <head> canonical link / og:url / JSON-LD @id and the .md frontmatter) and the remaining og:site_name / article:*time / RSS lastBuildDate / content:encoded items. Ordered by launch impact.

## A. SEO correctness of the public blog (highest value before Monday)

1. **JSON-LD `BlogPosting` — missing entirely.** No structured data anywhere on post pages.
   Add to the post route head (both slug- and host-based variants render via `PublicBlogPages.tsx`):
   headline, description, datePublished, dateModified, author, publisher, mainEntityOfPage,
   absolute image URL when `coverAssetId` exists. Biggest single SEO gap for an SEO-adjacent product.
2. **`og:image` is relative** (`/media-assets/<id>`, `PublicBlogPages.tsx` ~174/188) — social/AI
   scrapers need absolute URLs; the `og-origin` helper already exists, use it. While there:
   add `og:url`, `og:site_name`, `article:published_time`, `article:modified_time`.
3. **Sitemap lacks `<lastmod>`** (`server/public-feeds.ts` handleSitemap) — weakens crawl/refresh
   signals; cheap add from post timestamps.
4. **RSS is minimal** (handleFeed): add `<atom:link rel="self">`, channel `<lastBuildDate>`,
   `<content:encoded>` full HTML alongside the excerpt.
5. **Possible duplicate meta**: route `head()` and component body both emit og:title/description/
   canonical — verify the rendered `<head>` isn't doubled (React 19 hoisting usually dedupes; check once).

## B. Launch-operational

6. **Custom-hostname provisioning is prod-gated and unverified** (`CUSTOM_HOSTNAME_API_TOKEN`;
   FEATURES.md notes "verify at/after cutover") — custom-domain blogs are the least-proven surface.
   Verify one end-to-end before promising custom domains.
7. **Stale README** says REST is read/list-only — `/api/v1` is fully write-capable; fix the doc.
8. **No e2e tests for `/api/v1` HTTP layer or public SEO output** — the two untested surfaces.
   Cheap wins using the existing `*.worker.test.ts` patterns.

## C. ASP-integration prerequisites (when AutoSEOPilot connects)

9. **Tenant provisioning endpoint** — today a workspace+site auto-provisions only on interactive
   sign-in; ASP needs an internal API to provision on a customer's behalf (invisible-integration
   decision). Small endpoint, big unblock.
10. **Billing gate foot-guns for automation**: asset upload returns 402 on unsubscribed sites and
    free tier caps at 1 noindexed post — ASP-provisioned tenants must be active before first
    publish, or automation fails silently. Decide the provisioning/billing story.
11. **No idempotency-key / upsert-by-slug**: a create retry after partial success 409s on the slug.
    ASP will hold the id-map, but an `Idempotency-Key` header or `PUT /posts/by-slug/{slug}` would
    remove the desync class entirely.
12. (Later) **Direct-to-R2 upload path** — base64-over-JSON is fine at launch volume; revisit when
    many tenants publish 4 images/article concurrently.

## D. Deferred by founder decision

- Visual theme polish ("okay-ish" accepted for launch).

## Review verdict (for context)

Architecture is genuinely good: clean monorepo layering, unified REST+MCP operations, markdown-native
storage with presentation config, sane multi-tenancy, strong AI-crawler story (per-site llms.txt,
`.md` content negotiation, content-signal headers), SSR public pages. Items above are bounded fixes,
not rewrites. A (1–4) is the Monday-relevant set; C gates the AutoSEOPilot integration, not the launch.
