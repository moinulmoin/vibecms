# Decision: Host-only public-blog URL model (drop path-mode)

Status: **IMPLEMENTED** (updated 2026-07-14).
Supersedes path-mode references in older plans and archived launch material.

## Decision

VibeCMS uses a **host-only** URL model for public blogs. Tenant identity is always the **host**; content structure (posts, tags, feed, sitemap, robots, llms.txt) is the **path under that host**. Multi-tenant path-mode (`/blog/<siteSlug>/<postSlug>`) is **removed**.

- **Cloud**: `<slug>.vibecms.dev` (free subdomain) or custom domain (paid, Cloudflare for SaaS), with the dashboard/API on `app.vibecms.dev`.
- **Self-hosted**: single-tenant and host-based, with separate API/dashboard and public Astro Worker hosts.

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

## Resolved topology

- Development uses `app.basedui.dev` for API/dashboard and `basedui.dev` plus `*.basedui.dev` for public blogs.
- Production uses `app.vibecms.dev` for API/dashboard and `vibecms.dev` plus `*.vibecms.dev` for public blogs.
- Self-hosting mirrors the two-Worker split; root `wrangler.jsonc` and `wrangler.public.jsonc` share D1/R2 and connect through a service binding.

## Verification (post-removal)

- typecheck + full test suite green (unit + isolation).
- grep `PUBLIC_BLOG_URL_MODE | publicBlogUsesAppPath | pathModeBlogRedirect | resolveSiteBySlug | '/blog/$'` → no live code refs (historical doc mentions OK if marked historical).
- Redeploy dev; confirm host-mode routes still serve where reachable.

## References

- Advisor report: `agent://PathModeAdvisor` (exhaustive removal surface + ordered steps).
- Related: `plans/007-launch-infra-workers-paid-and-blog-subdomains.md` (dev wildcard), `docs/self-hosting.md`.
