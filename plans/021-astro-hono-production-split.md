# Astro + Hono production split

Status: approved for execution by the user on 2026-07-13.

## Goal

Replace the TanStack Start monolith with two deployed Cloudflare Workers while preserving every current URL and behavior:

```txt
apps/dashboard  TanStack Router + React SPA (static build only)
        │
        └── bundled as Workers Static Assets in apps/api

apps/api        Hono control-plane Worker on app.<domain>
                Better Auth, dashboard JSON API, REST v1, MCP,
                billing/webhooks, media mutations, static dashboard assets

apps/public     Astro SSR Worker on apex, tenant subdomains, and custom domains
                marketing, blog HTML, Markdown, tags/search, RSS/sitemap/robots/llms,
                public media reads, cacheable tenant rendering

packages/*      framework-independent domain, DB, contracts, renderer, UI
```

This is two deployed Workers, not three. The dashboard does not need SSR or its own Worker. Serving its Vite output from the Hono Worker's Static Assets binding keeps dashboard auth and JSON calls same-origin and removes CORS/cross-domain cookie complexity.

## Decisions

1. **One backend:** all privileged writes, Better Auth, bearer REST, MCP, billing, and dashboard operations live in one Hono Worker.
2. **One public renderer:** Astro owns every unauthenticated human/agent content route. It reads published D1/R2 data directly through shared packages; it does not make an API network request per page view.
3. **One release command:** root scripts build both Workers from one commit, run gates, migrate D1 once, deploy API before public, then smoke both release versions.
4. **No compatibility layer:** remove TanStack Start, `createServerFn`, the old Worker entrypoint, and obsolete wrappers after all callers move.
5. **Only additive database changes:** add the minimum durable state proven necessary for monotonic/idempotent Polar webhooks and atomic media quota reservations. Do not reshape existing content/auth data or add compatibility columns.
6. **Same-origin session API:** dashboard calls `/api/dashboard/*` with Better Auth cookies. Bearer REST remains `/api/v1/*`; MCP remains `/mcp`.
7. **No blanket CORS:** dashboard/auth are same-origin. Bearer clients do not need browser credential CORS. Add a narrow allowlist only if an existing browser contract proves it is required.
8. **Astro is not a content store:** D1-backed tenant Markdown keeps the existing unified/remark/rehype/sanitize pipeline. No content collections, trusted MDX, or Sätteri substitution.
9. **Blume is a design reference, not a dependency:** borrow restrained code frames, callouts, heading permalinks, captions, and documentation clarity. Do not import Blume's build-time MDX/AI-visibility system into runtime tenant content.
10. **No new queue or scheduler in this migration:** scheduled publishing, redirects, readiness scoring, and import remain the next roadmap phases.

## URL contract

### App/API Worker (`app.vibecms.dev`, `app.basedui.dev`)

- `/`, `/login`, `/dashboard/*` -> TanStack SPA assets/fallback
- `/api/auth/*` -> Better Auth
- `/api/dashboard/*` -> cookie-authenticated internal dashboard JSON API
- `/api/onboarding/ensure` -> preserved onboarding mutation
- `/api/v1/*` -> bearer REST/OpenAPI/Scalar
- `/mcp` -> bearer MCP JSON-RPC
- `/api/polar/webhook` -> signed Polar webhook
- `/api/export.json` -> owner export
- `/api/media/*` -> cookie-authenticated media mutations
- `/api/health/live`, `/api/health/ready` -> release and dependency health

Workers Static Assets must use:

```jsonc
{
  "assets": {
    "directory": "../dashboard/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": [
      "/api/*",
      "/mcp",
      "/mcp/*",
      "/webhooks/*",
      "/media-assets/*"
    ]
  }
}
```

`/api/*` must run the Worker first, including browser-navigation OAuth callbacks; otherwise SPA fallback can swallow the callback and return `index.html`.

### Public Astro Worker (`vibecms.dev`, `basedui.dev`, tenant/custom hosts)

- `/` -> marketing on the apex/app classification, blog index on tenant hosts
- `/:postSlug` and `/:postSlug.md` -> article HTML/Markdown
- `Accept: text/markdown` on article URLs -> canonical Markdown response
- `/tag/:tag`, search query behavior -> existing listing semantics
- `/feed.xml`, `/sitemap.xml`, `/robots.txt`, `/llms.txt` -> existing machine-readable outputs
- `/media-assets/:assetId` -> immutable R2 read
- `/api/subscribe` -> same-origin Astro endpoint delegating the write to a named API Worker service-binding entrypoint
- reserved app/API hosts must never resolve as tenant blogs

## Shared contracts

Extend `@vc/api-contract`; do not create a parallel contract package.

- Public REST/MCP operation schemas remain the canonical agent contract.
- Add dashboard request/response schemas for bootstrap, overview, posts/editor/version history, media, activity, billing, connect/tokens, settings/domains, voice profile, onboarding, checkout/portal, and export metadata.
- Move `OperationContext`, `AppUserContext`, session/bootstrap DTOs, mutation results, and public loader DTOs to stable shared exports.
- Build one typed dashboard fetch client that:
  - sends `credentials: "same-origin"`;
  - accepts `AbortSignal` from Router loaders;
  - requires JSON content types;
  - maps the existing `{ error: { code, message, details? } }` envelope;
  - never retries unsafe mutations automatically.

## Production Hono contract

### Middleware order

1. Canonical app-host redirect.
2. `requestId()`; return `X-Request-ID` and include it in every error envelope.
3. Redacted structured request log middleware.
4. Secure headers; CSP is route/static-asset specific rather than a permissive global policy.
5. `Cache-Control: no-store` for auth, session, dashboard, MCP, and bearer API responses.
6. Route-specific body limits and timeouts.
7. Route-group authentication/origin guards.
8. OpenAPI/dashboard/MCP handlers.
9. Central `notFound` and `onError` handlers.

### Security boundaries

- Better Auth mounted with `auth.handler(c.req.raw)`.
- Production `trustedOrigins` contains only the configured app origin; localhost is development-only.
- Force secure cookies in production; preserve `HttpOnly` and `SameSite=Lax`; do not enable cross-domain cookies.
- Better Auth retains its origin/CSRF checks. Every unsafe cookie-authenticated dashboard route additionally enforces exact same-origin `Origin`/`Referer` or `Sec-Fetch-Site: same-origin`.
- Bearer REST/MCP retain hashed token lookup, scopes, workspace/site isolation, exact-version publish preconditions, D1 usage reservations, and rate-limit headers.
- Webhooks remain signature-verified and idempotent before side effects.
- Public API docs remain unauthenticated; no privileged route is mounted before its auth middleware.
- Do not log authorization headers, cookies, bodies, OTPs, email addresses, content, Polar payloads, or secrets.

### Atomic side effects and ordering

- Persist Polar webhook ID, source timestamp, and applied state. Duplicate deliveries are no-ops; older valid events cannot overwrite newer billing state.
- Make API-key create/revoke and their activity events one D1 atomic unit. Never create an active unrevealed key or revoke without an audit event.
- Reserve media bytes atomically before R2 upload so concurrent requests cannot exceed the site quota.
- Validate image magic bytes/decoded dimensions before persistence; declared MIME alone is not trusted.
- If R2 succeeds and D1 asset/activity persistence fails, delete the object. If compensation fails, emit a correlated recovery event.
- Register cache purge and other post-response work with `executionCtx.waitUntil`; no floating promises.
- Give Cloudflare hostname and purge fetches bounded `AbortSignal` deadlines and controlled retryable results.
- Preserve the existing deliberate OTP rate-limit fail-open behavior, but emit a redacted correlated error; subscriber abuse protection remains fail-closed.

### Limits and errors

- Small JSON/auth/dashboard requests: explicit low body limits.
- Markdown payloads: limit derived from the existing 500,000-character contract.
- Base64 media upload: endpoint-specific limit derived from the existing 10 MB binary ceiling; no global high limit.
- Long-running media/webhook paths get explicit, larger timeouts; ordinary API paths get a bounded default.
- Preserve domain `AppError`; map only once in `onError`.
- Validation returns `VALIDATION_ERROR`; unknown failures return generic `INTERNAL_ERROR` and are logged with request ID.
- Add JSON 404/405 behavior for Worker routes without leaking stack traces.
- Limit enforcement must reject both oversized `Content-Length` requests and chunked/lying bodies before JSON, text, or multipart parsing.

### Observability

Both Worker configs use compatibility date `2026-07-13`, generated binding types, source-map upload, and `version_metadata`.

- API: 100% structured logs for launch, 10% traces.
- Public: structured error/request logs with lower success sampling, 5% traces.
- Log fields: event, requestId, Worker version/tag, method, normalized route, status, durationMs, auth kind, workspace/site/token IDs when already known, error code/name, `cf-ray`.
- No PII or request-body logging.
- `/api/health/live` proves the Worker/version is alive.
- `/api/health/ready` performs bounded D1 readiness and returns 503 on dependency failure.
- Public Worker gets a reserved health endpoint that cannot be mistaken for a tenant post.
- Use Cloudflare native logs/traces first; keep OTLP export configurable without adding a vendor SDK.

## Public Astro contract

- `astro@7.0.8`, `@astrojs/cloudflare@14.1.3`, `@astrojs/react@6.0.1`, `output: "server"`.
- Prefer Astro's normal server entrypoint and middleware. Use Advanced Routing only where host dispatch/cache ordering demonstrably requires it; do not add Hono to the public Worker merely because Astro exposes `astro/hono`.
- React article components render server-only with no `client:*` hydration. Use a tiny progressive-enhancement script only for code-copy behavior.
- Access bindings through Cloudflare runtime locals; no `process.env`.
- Public Worker gets D1 and R2 bindings but no Better Auth, token pepper, email, Polar, or Cloudflare account secrets.
- Public writes use the named service-binding RPC surface, not a public internal HTTP endpoint.
- Preserve sanitized HTML, one H1, canonical/OG metadata, structured data, Content-Signal, X-Robots-Tag, link safety, image metadata, dark/light themes, and Markdown parity.

### Cache correctness

Use Astro's Cloudflare cache provider rather than the current dashboard-era comments/cache-rule dependency.

- Article responses: `vc-site:<siteId>` and `vc-article:<siteId>:<slug>` tags.
- Index/tag/search/feed/sitemap/robots/llms: `vc-site:<siteId>` tag, with search remaining no-store/noindex.
- Publish, published-edit, archive, restore, theme, domain, and SEO changes purge the affected site/article tags.
- Use platform `cache.purge({ tags })`; remove the API-token purge dependency when parity is proven.
- Keep conditional validators (`ETag`/`Last-Modified`) and distinct cache keys for HTML vs negotiated Markdown vs `.md`.
- Cache failures are logged and fail open after the authoritative D1 commit; tests prove stale content cannot survive a successful purge.

## Rich-content refinement

Extract the current renderer and `--vc-*` styles into one shared `@vc/content` package used by Astro and dashboard preview. Preserve synchronous, sanitized rendering and increment `RENDERER_VERSION` for visible output changes.

Bounded Blume-informed changes:

- retain GitHub-style callout syntax but reduce large saturated fills; color is semantic and localized to icon/border;
- add accessible heading permalink affordances without changing generated IDs;
- turn `pre[data-lang]` into a quiet code frame with language metadata and a copy action;
- preserve 65-75ch article measure, larger 18-19px body type, responsive tables, figures/captions, TOC, dark mode, and print behavior;
- add syntax highlighting only if the same deterministic renderer works in Worker SSR and browser preview without violating bundle/performance thresholds;
- never allow raw HTML/MDX, nested callouts, executable embeds, or arbitrary component directives.

## Execution waves

### Wave 0: contracts and build boundaries

1. Add `@vc/content` and move the renderer/styles with focused parity tests.
2. Expand `@vc/api-contract` for dashboard/public DTOs.
3. Duplicate the current app into an isolated `apps/dashboard` migration target while leaving `apps/web` frozen as the source until API/public extraction is complete.
4. Add `apps/api` and `apps/public` package/config skeletons.

### Wave 1: parallel application extraction

- **API slice:** move env-bound server modules into `apps/api`, create route groups/middleware/health/observability, expose dashboard endpoints, preserve REST/MCP/auth/webhook behavior.
- **Dashboard slice:** remove TanStack Start/server functions, wire the typed client and pure Router/Vite build, preserve every page/loading/error/auth/onboarding state.
- **Public slice:** port marketing/blog routes to Astro, preserve host dispatch/render/SEO/feed/Markdown/media behavior, enable cache provider and tags.

Slices may read frozen `apps/web`; they must not edit another slice's target.

### Wave 2: integration and clean cutover

1. Wire dashboard assets into the API Worker.
2. Wire the public subscribe service binding and cross-Worker cache invalidation.
3. Split hosted dev/prod routes and bindings across API/public configs.
4. Replace root scripts with one two-Worker build/dev/deploy orchestration.
5. Provide a documented two-Worker self-host deployment from one root command; do not retain the TanStack Start monolith as a hidden fallback.
6. Delete `apps/web`, TanStack Start dependencies, server-function wrappers, duplicate public renderers/styles, and stale generated files.
7. Regenerate OpenAPI and Worker binding types.

## Verification gates

### Focused automated checks

- Contract tests for every dashboard endpoint and error envelope.
- Hono integration tests for auth/session origin rejection, bearer scopes, tenant isolation, quotas, body limits, timeout mapping, request IDs, no-store, 404/500 redaction, health readiness, webhook signature/idempotency, and exact-version publish conflicts.
- Existing MCP/REST parity tests and OpenAPI snapshot/check.
- Renderer tests for sanitizer invariants, callouts, code metadata/copy markup, heading IDs/permalinks, TOC, figures, tables, HTML/Markdown equivalence, and XSS payloads.
- Astro Worker tests for apex/tenant/custom/app hosts, HTML, `Accept: text/markdown`, `.md`, tags/search, RSS, sitemap, robots, llms, media, 404, noindex, cache tags, and invalidation.
- Dashboard route/component tests for login, bootstrap, setup, connect, editor, posts, media, activity, billing, settings, and network errors.

### Repository gates

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm openapi:check
pnpm public:audit
```

Build evidence must show:

- no TanStack Start/server-function chunk in dashboard;
- no React/TanStack/Better Auth/Polar code in the public Worker unless explicitly required;
- API Worker does not bundle public page components;
- dashboard initial route and Worker bundles do not regress materially from the measured monolith baseline;
- both Workers remain below Cloudflare bundle limits.

### Deployed dev smoke

Deploy dev only after local gates:

1. API/public release versions match the same git commit/tag.
2. Email OTP login -> auto-submit -> setup -> connect -> safe read check -> first publish.
3. Dashboard CRUD, version preview/restore, media, settings, billing sandbox, token create/revoke.
4. Bearer REST and MCP create/preview/version-pinned publish.
5. Public default subdomain and custom-domain-equivalent host: HTML, Markdown negotiation, `.md`, feeds, cache miss/hit, publish purge, dark/light, mobile/desktop.
6. Inspect Cloudflare logs/traces: correlated request IDs, expected health, no secrets/PII/content.
7. Verify D1 state and R2 reads for the smoke workspace.

Production deployment is not automatic from this branch. The release is production-ready only after dev evidence and independent review; production promotion remains an explicit final command.

## Rollback

- No destructive schema migration in this change.
- Both Workers expose version metadata and retain prior Cloudflare versions.
- If dev smoke fails, redeploy the previous API and public versions together.
- API/public shared contracts remain backward-compatible during the deploy window; deploy API first, public second.
- Do not resurrect `apps/web` or add runtime compatibility shims after cutover.

## Research basis

- Cloudflare Workers Static Assets SPA routing and selective `run_worker_first`: <https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/>
- Cloudflare Workers observability/logs/traces and OTLP export: <https://developers.cloudflare.com/workers/observability/>
- Cloudflare Workers production practices: <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- Hono Cloudflare Workers, request ID, CSRF, body limit, timeout, and secure headers: <https://hono.dev/docs/getting-started/cloudflare-workers>
- Better Auth Hono integration and security/trusted origins: <https://better-auth.com/docs/integrations/hono>, <https://better-auth.com/docs/reference/security>
- Astro Cloudflare adapter, server output, React SSR, runtime cache/CSP: <https://docs.astro.build/en/guides/integrations-guide/cloudflare/>
- Blume source/docs inspected at `haydenbleasel/blume`; only portable presentation conventions are adopted.
