# Decision: Host-only public-blog URL model (drop path-mode)

Status: **DECIDED + implementation in progress** (2026-07-05).
Supersedes path-mode references in README, docs/self-hosting.md, docs/launch-runbook.md, docs/FEATURES.md, plans/002, 007, 008, 020, PROD-LAUNCH.

## Decision

VibeCMS uses a **host-only** URL model for public blogs. Tenant identity is always the **host**; content structure (posts, tags, feed, sitemap, robots, llms.txt) is the **path under that host**. Multi-tenant path-mode (`/blog/<siteSlug>/<postSlug>`) is **removed**.

- **Cloud**: `<slug>.vibecms.dev` (free subdomain) or custom domain (paid, Cloudflare for SaaS). Production already runs host-only (`PUBLIC_BLOG_URL_MODE=subdomain`, `APP_URL=app.vibecms.dev`, `PUBLIC_BLOG_DOMAIN=vibecms.dev`).
- **Self-hosted** (future, post-release): single-tenant, host-based. Topology to be chosen closer to release (separate app/blog hosts, or a single-site same-host resolver). Not shipped today.

## Rationale

- VibeCMS positions as a blog-**host** (tenants own audience + SEO), not a content-network. Matches Hashnode / Ghost / Substack.
- Path-mode (`vibecms.dev/<blog>/post`) builds authority for the platform, not the tenant; undermines the custom-domain upgrade lever; looks like "a feature of someone else's site."
- Advisor-validated (PathModeAdvisor, 2026-07-05): tenant-identity-by-host is the correct model for a blog-host; host-mode is already the fuller SEO model (feeds/sitemaps/robots/llms host-resolved).

## No migration

VibeCMS is **unreleased**. No live users, no legacy `/blog/<slug>` links, self-host not yet shipped. Removal is clean — no redirects or compat layer needed.

## What's removed (code)

- **Routes**: `routes/blog/$siteSlug/index.tsx`, `$postSlug.tsx`, `tag/$tag.tsx`, `llms[.]txt.ts` (+ regenerate `routeTree.gen.ts`).
- **Helpers/loaders**: `pathModeBlogRedirect`, `loadPublicPostBySlug` / `loadPublicIndexBySlug` / `loadPublicTagBySlug`, `handlePublicPostBySlugGet`, `handleLlmsTxtBySlug`, app-layer `resolveSiteBySlug`, read-model `resolveSiteBySlug`.
- **Gate**: `PUBLIC_BLOG_URL_MODE`, `publicBlogUsesAppPath()`, `appPublicBlogUrl()`.
- **Fallout fixes** (callers made host-only): `canonical-host.ts` / `.server.ts`, `resolve-app-router-context.server.ts`, `site-public-url.ts`, `cms-dashboard.ts`, `SettingsPage.tsx` "View public blog" link, `public-blog-cache.ts` purge URLs.

## What stays (host-mode)

- Routes: `$postSlug.tsx`, `tag/$tag.tsx`, `feed[.]xml.ts`, `sitemap[.]xml.ts`, `robots[.]txt.ts`, `llms[.]txt.ts`, root `index.tsx`.
- Loaders: `loadPublic*ByHost`, `resolveSite(request)` (host-based), `isPublicBlogIndexable()`.
- `defaultHostname(slug)`, `publicBlogBaseDomain()`, `isLocalDefaultHostname()` (default-subdomain creation).
- `site.slug` (still used for onboarding, default subdomain, reserved-slug validation, subscribe API).

## Open topology decisions (for release, NOT blocking this removal)

1. **Dev dogfooding**: host-based needs `*.dev.vibecms.dev` wildcard DNS/cert (or an alternate dev host strategy). Today dev served path-mode; after removal dev blog-serving requires this. (The dev `/blog/*` 404 already made path-mode unusable there.)
2. **Self-host topology**: separate app/blog hosts vs. single-site same-host resolver. Decide closer to release.

## Verification (post-removal)

- typecheck + full test suite green (unit + isolation).
- grep `PUBLIC_BLOG_URL_MODE | publicBlogUsesAppPath | pathModeBlogRedirect | resolveSiteBySlug | '/blog/$'` → no live code refs (historical doc mentions OK if marked historical).
- Redeploy dev; confirm host-mode routes still serve where reachable.

## References

- Advisor report: `agent://PathModeAdvisor` (exhaustive removal surface + ordered steps).
- Related: `plans/007-launch-infra-workers-paid-and-blog-subdomains.md` (dev wildcard), `docs/self-hosting.md`.
