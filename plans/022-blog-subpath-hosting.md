# 022 - Serve a blog at a path on the customer's own site (customer.com/blog)

Status: IN PROGRESS. Phase 1 (location core) done 2026-10-10: data layer, PublicLocation + `/_vc/p/` ingress, primary-location URLs + entitled redirects, cache keys + purge, link rewriting; built by omp task agents, reviewed by omp reviewer (3 rounds). Next: phase 2 (assets, CSP, fonts). Priority P1, effort L. Depends on: nothing; pairs with
023 (human/agent analytics) and 024 (SEO checks).

## Why

AutoSEOPilot customers (and most companies) want the blog at `customer.com/blog`, not
`blog.customer.com` or `<slug>.vibecms.dev`: the posts then build authority for the domain
that sells. Every SEO blog tool gets asked for this; most can't do it well. It is the
"killing blow" feature for the AutoSEOPilot channel.

This does **not** reopen `docs/url-architecture-decision.md`. That decision removed
*platform* path-mode (`vibecms.dev/<blog>/...`), which built authority for vibecms. Here
the blog lives on the **customer's** host, so the tenant keeps the authority, which is exactly
what that decision was protecting. Tenant identity stays host-based; this adds a base path
under the tenant's own host.

## Cloudflare facts (checked 2026-10-09)

- Cloudflare for SaaS custom hostnames route whole hostnames only; there is no path-level
  custom hostname. So the customer's side must send `/blog/*` to us.
- Customer on Cloudflare: a Worker on the route `customer.com/blog*` works on the
  **Workers Free** plan (100k requests/day per account, then Error 1027). Recommend
  **Workers Paid** ($5/mo, 10M requests/month included) for busy blogs.
  Snippets can do the same but need a Pro zone.
- Vercel / Netlify / Next.js / nginx / Caddy: a rewrite or proxy rule, no Cloudflare plan.
- Workers static assets honour a `_headers` file (needed for cross-origin fonts below).
- Hosted vibecms is on Workers Paid; nothing here may require paid features for
  self-hosters.

## Design

### 1. Data model

- `domains` gains a nullable `base_path` column and the type `subpath`
  (`default` | `custom` | `subpath`). New migration; never edit old ones.
  `base_path` is lowercase, starts with `/`, 1-3 segments, no trailing slash, and must not
  start with a vibecms-reserved segment (`/_vc`, `/api`, `/_astro`, `/media-assets`, `/og`).
- `domains` gains `proxy_id`: a random, non-guessable id (24+ chars) used in the
  proxy target URL. It isn't a secret: it identifies proxied traffic. Spoofing it only
  renders our pages with the real customer canonical, so it's harmless. Rotatable.
- A site has at most one `subpath` domain. Subpath hosting is a paid entitlement, like custom domains.
- `validateCustomHostname` stays bare-host; a new `validateSubpathLocation(url)` parses
  `https://customer.com/blog` into hostname + base path. Refuse platform-zone and app hosts.

### 2. One "public location" per request

Add `PublicLocation = { origin: string; basePath: string; assetOrigin: string; proxied: boolean }`
(`apps/public/src/server/public-location.ts`), computed once in middleware and put on
`Astro.locals`. Every URL producer takes it instead of reading `request.url` / Host:

- direct request: `{ origin: request origin, basePath: '', assetOrigin: same, proxied: false }`
- proxied request: `{ origin: 'https://customer.com', basePath: '/blog',
  assetOrigin: 'https://<slug>.<PUBLIC_BLOG_DOMAIN>', proxied: true }`

The existing `basePath` plumbing (loaders, `PublicBlogPages.tsx`, `presented-post.tsx`,
`renderLlmsTxt`, `tryPublicPostMarkdownResponse`) is fed from it instead of `""`.

### 3. Proxy ingress (works with any proxy, no custom headers needed)

The customer proxies `customer.com/blog/:path*` →
`https://<slug>.<PUBLIC_BLOG_DOMAIN>/_vc/p/<proxy_id>/:path*`.

Middleware, before site resolution:
1. Match `^/_vc/p/<id>(/.*)?$`, look up the active `subpath` domain by `proxy_id` and check it
   belongs to the site resolved from the Host header.
2. Build the proxied `PublicLocation` from that domain row and internally rewrite to `/<rest>`.
3. Unknown or inactive id → 404 (never fall back to rendering).

Putting the id in the path, not a header, means Vercel/Netlify rewrites (which can't add
request headers) work unchanged. The customer's real host comes from our domain row, not
from `X-Forwarded-Host`, so nothing trusts client-supplied host headers.

### 4. Primary location and redirects (also fixes an existing gap)

Today a site with a custom domain is still fully served, duplicate, on `<slug>.vibecms.dev`,
and API/MCP `url`s ignore custom domains (`getSitePublicBaseUrl` uses the default host only).

- Add `primaryLocation(site)`: active `subpath` > active `custom` > default. Use it in
  `getSitePublicBaseUrl`, `operations.ts` post URLs, `mapSiteRow`, dashboard `publicBaseUrl`,
  `autoseopilot-managed.ts`, preview links stay on the default host.
- Direct GET/HEAD for an HTML page (index, post, tag) on a non-primary host → 301 to the
  same path at the primary location. Exempt: `/_vc/*`, `/_astro/*`, `/media-assets/*`,
  `/og*`, `/api/*`, `/preview/*`, `/__vc-health`. Proxied requests are never redirected.

### 5. Assets, CSP, fonts

`/_astro/*` and `/favicon.svg` are root-relative today, so they would 404 on
customer.com. In proxied responses:
- An `HTMLRewriter` pass rewrites `src`/`href` that start with `/_astro/`,
  `/favicon.svg`, `/media-assets/` and `/og` to `assetOrigin + path`. That covers Astro-injected
  `<link rel=stylesheet>`, `?url` scripts, font preloads, favicon, covers and OG meta. These
  load straight from our host, so they don't count against the customer's Worker requests.
- CSS `url(/_astro/font.woff2)` resolves against the stylesheet's origin (ours), so it
  works. Add `apps/public/public/_headers`: `/_astro/*` → `Access-Control-Allow-Origin: *` (the
  font loads are cross-origin; preloads get `crossorigin`).
- CSP for proxied responses (in `secure-response-headers.ts`): add `assetOrigin` to
  `script-src`, `style-src`, `font-src`; `connect-src 'self'` stays correct because
  beacons and markdown fetches go through the proxy (below).
- Post bodies store `/media-assets/<id>`: the renderer maps that to `assetOrigin` in
  proxied mode, and the feed renderer's absolute-URL pass uses `assetOrigin` too.

### 6. Links that must go through the proxy (same-origin)

Prefix with `basePath`: index, posts, tags, pagination, search form action, feed,
sitemap, llms.txt, `.md` twins, `PublicNotFoundView` links, slug redirects `Location`,
`/api/analytics/view` and `/api/subscribe` (scripts read the base from a
`data-vc-base` attribute on `<html>`), and `reading.js` markdown fetch (already absolute
from `markdownUrl`).

Root-relative links written in post Markdown (`/pricing`) keep normal HTML meaning: the
customer's site root. Links to this blog's own posts: the format guide tells agents to
use the post `url` the API returns, which already includes `/blog`. The renderer also
prefixes `basePath` when a root-relative link's first segment is a published slug of this
site (so `/my-post` keeps working after a move).

### 7. Absolute URLs (SEO and agents)

Use `origin + basePath` for: canonical, `og:url`, JSON-LD (`mainEntityOfPage`, blog
`url`), markdown `canonical` frontmatter and `Link` headers, RSS channel/item/self links,
sitemap entries, llms.txt entries, `tenantHomeLinks`, OG card host label
(`customer.com/blog`).

**Root files belong to the customer.** Crawlers only read `customer.com/robots.txt`
and agents look for `customer.com/llms.txt`. We serve `customer.com/blog/sitemap.xml`
and `/blog/llms.txt`, and the dashboard shows the lines to add to their root files
(`Sitemap: https://customer.com/blog/sitemap.xml`). The setup check (below) warns when
the root `robots.txt` lacks it. Our `/blog/robots.txt` is still served but only for completeness.

### 8. Caching

- Workers Cache key today = full request URL (our host). Proxied and direct traffic
  share our host, so the key becomes `origin + basePath + path` from `PublicLocation`.
- Responses to proxied requests send `Cache-Control: public, max-age=0, must-revalidate`
  (plus the existing ETag) so the customer's CDN (their Cloudflare zone, Vercel) never holds
  a stale post we can't purge; our own edge cache keeps it fast. Purges stay tag-based
  (`vc-site:` / `vc-article:`), so no URL list changes; `purgeArticleCache` gains custom
  and subpath hosts for URL-based fallbacks.

### 9. Analytics and visitor details

- Page-view endpoint: the `Origin` check compares against `PublicLocation.origin`;
  referrer self-filter compares against the customer host.
- Subscribe rate limit: proxied requests read the first `X-Forwarded-For` entry for the
  IP hash (spoofable, but only affects the subscribe rate limit; keep the per-site cap).
- AI crawler counts today come from zone analytics per host; proxied crawler hits arrive
  at our default host only if the proxy forwards the UA. Snippets forward all request
  headers. The robust fix (count every request first-party, labelled human/agent) is 023.

### 10. Setup UX (dashboard + API + MCP)

- Settings → Domain gains a third option: **"On a path of your site"** (`customer.com/blog`).
  The user enters the URL. Then:
  - Tabs give ready-to-paste snippets with the proxy URL filled in: **Cloudflare Worker**
    (code + route `customer.com/blog*`, a note on Free vs Paid limits), **Vercel / Next.js**
    (`rewrites`), **Netlify** (`_redirects` 200), **nginx**, **Caddy**.
  - **Check setup** button: the API fetches `https://customer.com/blog/_vc/health` and expects
    `{ siteId, proxyId }` back. It reports what's wrong in plain words: no response, wrong site,
    redirect loop, HTML cached by their CDN, missing sitemap line in root `robots.txt`.
  - Domain status uses the existing `pending/active/failed` vocabulary; the daily cron
    re-checks active subpath domains and flags breakage.
- REST/MCP: `sites.domains` gains `subpath` add/check/remove; AutoSEOPilot managed API gains
  `PUT .../sites/:id/location` returning the proxy target and snippets.
- Cloudflare Worker snippet (the whole thing; free plan OK):

```js
export default {
  async fetch(req) {
    const url = new URL(req.url)
    const rest = url.pathname.replace(/^\/blog/, '') || '/'
    const target = `https://SLUG.vibecms.dev/_vc/p/PROXY_ID${rest}${url.search}`
    return fetch(new Request(target, req))
  },
}
```

## Phases

1. **Location core**: migration, `PublicLocation`, `/_vc/p/` ingress, cache key, `primaryLocation`
   + redirects, all URL producers fed from it. Unit + isolation tests for both modes.
2. **Assets and browser**: HTMLRewriter pass, `_headers`, CSP, scripts' `data-vc-base`.
3. **Setup UX**: dashboard Domain option, snippets, Check setup, cron re-check, REST/MCP/managed API.
4. **Docs**: setup guide per platform, Free vs Paid note, root `robots.txt`/`llms.txt` lines.

## Verification

- Unit/isolation: every producer listed in sections 6-7 emits `/blog`-prefixed or absolute customer URLs in
  proxied mode and is unchanged in direct mode; cache keys differ; unknown proxy id → 404;
  non-primary direct HTML → 301; exempt paths never redirect.
- Dev end-to-end on a real separate Cloudflare zone (needs a spare test domain): Worker
  route on `test-domain/blog*` → basedui.dev site. Check index, post, tag, search, pagination,
  feed, sitemap, llms.txt, `.md` twin, OG image, fonts (no CORS errors), subscribe, page-view
  beacon, preview link still on default host. Repeat with a Vercel rewrite.
- Browser: no console/CSP errors; Lighthouse SEO on the proxied post; canonical =
  `https://test-domain/blog/<slug>`.

## Out of scope

Hosting at the customer's root path (`customer.com/`), several subpath locations per site,
our own OAuth flow that installs the Worker on the customer's Cloudflare account (v2;
AutoSEOPilot can do it with a customer-provided token meanwhile), a Deploy-to-Cloudflare
button (v2).

## Decisions to confirm

- Proxy id in the path (not a header). Recommended: works with every proxy.
- Assets from our host (fewer customer Worker requests) vs everything through the proxy
  (no CORS/CSP work, more requests). Recommended: our host.
- Subpath domains require the paid plan, same as custom domains.
