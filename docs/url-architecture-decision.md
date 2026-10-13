# Decision: Host-only public-blog URL model (drop path-mode)

Status: **IMPLEMENTED** (updated 2026-07-14).
Supersedes path-mode references in older plans and archived launch material.

Addendum (2026-10-13): plan 022 shipped customer-owned subpath hosting
(`customer.com/blog`). That is a different feature from the platform
`/blog/<siteSlug>` path-mode removed here: the blog lives under the tenant's
own host, so tenant identity stays host-based and the tenant keeps the SEO
authority. A site's primary location can now be host + base path, not always
the host root.

## Decision

VibeCMS uses a **host-based** URL model for public blogs. Tenant identity is always the **host**; content structure (posts, tags, feed, sitemap, robots, llms.txt) is the **path under that host**. Multi-tenant path-mode (`/blog/<siteSlug>/<postSlug>`) is **removed**.

## Rationale

- VibeCMS positions as a blog-**host** (tenants own audience + SEO), not a content-network. Matches Hashnode / Ghost / Substack.
- Path-mode (`vibecms.dev/<blog>/post`) builds authority for the platform, not the tenant; undermines the custom-domain upgrade lever; looks like "a feature of someone else's site."
- Advisor-validated (PathModeAdvisor, 2026-07-05): tenant-identity-by-host is the correct model for a blog-host; host-mode is already the fuller SEO model (feeds/sitemaps/robots/llms host-resolved).

## No migration

VibeCMS was **unreleased** when this decision was made (July 2026): there were no live users or existing `/blog/<slug>` links, and self-host had not shipped. Removal was clean, with no redirects or compatibility layer needed. (Hosted production has since launched; this remains the record of the July removal rationale.)

## What's removed (code)

- **Routes**: `routes/blog/$siteSlug/index.tsx`, `$postSlug.tsx`, `tag/$tag.tsx`, `llms[.]txt.ts` (+ regenerate `routeTree.gen.ts`).
- **Helpers/loaders**: `pathModeBlogRedirect`, `loadPublicPostBySlug` / `loadPublicIndexBySlug` / `loadPublicTagBySlug`, `handlePublicPostBySlugGet`, `handleLlmsTxtBySlug`, app-layer `resolveSiteBySlug`, read-model `resolveSiteBySlug`.
- **Gate**: `PUBLIC_BLOG_URL_MODE`, `publicBlogUsesAppPath()`, `appPublicBlogUrl()`.
- **Fallout fixes** (callers made host-only): `canonical-host.ts` / `.server.ts`, `resolve-app-router-context.server.ts`, `site-public-url.ts`, `cms-dashboard.ts`, `SettingsPage.tsx` "View public blog" link, `public-blog-cache.ts` purge URLs.

## What stays (host-mode)

- Pages/endpoints (current Astro surface): `apps/public/src/pages/*.astro` (index, post, tag) plus feed/sitemap/robots/llms `*.ts` endpoints, dispatched host-first by middleware. (Originally TanStack route files; names updated 2026-10-13.)
- Loaders: `resolveSiteByHost`, `resolveSite(request)` (host-based), `isPublicBlogIndexable()`.
- `defaultHostname(slug)`, `publicBlogBaseDomain()`, `isLocalDefaultHostname()` (default-subdomain creation).
- `site.slug` (still used for onboarding, default subdomain, reserved-slug validation, subscribe API).

## Resolved topology

- Development uses `app.basedui.dev` for API/dashboard and `basedui.dev` plus `*.basedui.dev` for public blogs.
- Production uses `app.vibecms.dev` for API/dashboard and `vibecms.dev` plus `*.vibecms.dev` for public blogs.
- Self-hosting mirrors the production split plus an optional OG Worker; the root `wrangler.jsonc`, `wrangler.public.jsonc`, and optional `wrangler.og.jsonc` configs connect through service bindings. Only API and public share D1/R2 — OG binds neither (the `apps/*` Wrangler configs target the hosted dev/prod resources instead).

## Verification (post-removal)

- typecheck + full test suite green (unit + isolation).
- grep `PUBLIC_BLOG_URL_MODE | publicBlogUsesAppPath | pathModeBlogRedirect | resolveSiteBySlug | '/blog/$'` → no live code refs (historical doc mentions OK if marked historical).
- Redeploy dev; confirm host-mode routes still serve where reachable.

## References

- Advisor report: `agent://PathModeAdvisor` (exhaustive removal surface + ordered steps).
- Related: `plans/007-launch-infra-workers-paid-and-blog-subdomains.md` (dev wildcard), `docs/self-hosting.md`.
