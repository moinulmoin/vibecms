# Plan 009: Expose one public API (OpenAPI 3.1) plus a CLI over the unified core

> **Executor instructions**: Multi-phase. Each phase has its own acceptance gate; do not advance until the current phase is green. Build/verify ONLY the package/app you touch; Main runs repo-wide gates + the deployed smoke at integration points. Preserve the verified agent-auth boundary at every step (see "Security invariant" below). Do NOT expand scope into the "what NOT to do" list.

## Status

- **Priority**: P1 (founder direction; post-migration, at/after public launch)
- **Effort**: M-L
- **Risk**: MED (new in-worker framework surface, but on a mount pattern the repo already uses; security boundary already verified)
- **Depends on**: 008 (TanStack cutover, DONE). Reuses verified bearer auth + quota + `@vc/core`.
- **Category**: architecture, agent-surface, developer experience
- **Planned at**: 2026-06-16, oracle-reviewed (agent `ApiArchOracle`)

## Why (decision record)

VibeCMS funnels humans (cookie session) and agents (Bearer token) through ONE `@vc/core`. The agent surface is strong over MCP (10 tools at `/mcp`) but REST is a thin read sliver (`GET /api/posts`) with no formal contract, no CLI, and no published package. The goal is "one public API": a versioned REST API with a committed OpenAPI 3.1 spec, consumed by a CLI and external clients, with the existing HTTP MCP sharing the same internals.

Key decisions (oracle-validated; some overturn the initial lean):

- **Framework: Hono + `@hono/zod-openapi`, mounted via a TanStack splat route** at `apps/web-next/src/routes/api/v1/$.ts` (`createFileRoute('/api/v1/$')` + an ANY handler delegating to an `OpenAPIHono` app based at `/api/v1`). This is the SAME delegation pattern Better Auth already uses (`apps/web-next/src/routes/api/auth/$.ts:11-16`), so it is consistent with existing code, not a foreign framework. It is less total code than TanStack `createFileRoute` handlers plus a standalone spec registry because Hono unifies routing + validation + response declaration + OpenAPI emission. Keep `wrangler main` as the default TanStack server entry; do NOT replace it; do NOT split a second worker. (Reverses the earlier "stay on TanStack" lean.)
- **Transport (A-prime)**: `/api/v1` is the public REST contract for the CLI and external consumers. The existing in-worker HTTP `/mcp` stays the PRIMARY agent transport and shares the same internal operation layer. No custom npm MCP package (stdio-only clients use `mcp-remote`, already documented). SDK deferred. Only `@vibecms/cli` is published; `@vc/*` engine packages stay private and unrenamed.
- **Single source of truth**: a new contract-only package `@vc/api-contract` (pure, no Cloudflare deps) holds public request schemas, response DTO schemas, operationIds, required scopes, the error envelope, pagination, and pure DTO mappers. `@vc/validators` is NOT reused directly for the public surface: it is input/domain-oriented and includes internal fields like `siteId` (`packages/validators/src/post.ts:23-65`), which clients must never supply.

## Security invariant (must hold at every phase)

Verified 2026-06-16: `authenticateBearerToken()` (`apps/web-next/src/server/api-keys.ts:279`) resolves `{actor, siteId, workspaceId, tokenId}` server-side from the hashed token; handlers pass that `siteId` into core (never from the request); `@vc/db` scopes every post query by `WHERE site_id = ?`; `@vc/core` enforces a scope per op. REST request schemas MUST NOT accept `siteId`/`workspaceId`. Every REST op runs the proven shape: authenticate bearer -> `enforceApiBudget` -> core op -> stable DTO.

## Target architecture

- **`@vc/api-contract`** (new, private, pure): request/response zod schemas, operationIds, per-op required scope, behavior annotations (read-only / destructive / idempotent), error envelope, pagination, DTO mappers. Each response DTO is the SINGLE source for three consumers - the REST response schema (OpenAPI), the MCP tool `outputSchema` + `structuredContent`, and the CLI/client types - so structured output is defined once and cannot drift.
- **Operation layer** (in `apps/web-next`, env/D1/R2-bound): consolidated operation functions that BOTH the Hono REST handlers AND the existing `/mcp` `callTool` route through. Refactor `apps/web-next/src/server/mcp.ts` `callTool` to call these (no behavior change) so there is one dispatch.
- **Hono app**: `OpenAPIHono` based at `/api/v1`, bearer-auth middleware (reuse `authenticateBearerToken`) + quota, the 10 operations, `GET /api/v1/openapi.json` + Scalar docs at `/api/v1/docs`.
- **`@vibecms/cli`**: thin wrapper over a client generated/bundled from the committed `openapi.json`; auth = base URL + `Authorization: Bearer vc_...`; works against hosted or self-host.

## Agent ergonomics (first-class - the CLI and MCP are consumed by agents)

The CLI and MCP must give an agent enough context to act and decide the next step. Researched 2026 conventions, baked into the gates below:

- **MCP tools**: descriptions written like onboarding a teammate - what the tool does, input expectations, and the error conditions it can return. Return `structuredContent` conforming to a per-tool `outputSchema` (the `@vc/api-contract` response DTOs; spec 2025-06-18, already negotiated by this server) AND keep the serialized JSON in a `TextContent` block for client compat. Add behavior `annotations` (`readOnlyHint` on reads, `destructiveHint` on archive, `idempotentHint` where true) so agents decide when to call. Errors stay actionable with recoverable-vs-fatal preserved (recoverable -> `isError` tool result; auth/billing/rate-limit/protocol -> JSON-RPC). Keep the curated 10-tool surface and stable names; the `initialize` `instructions` teach the draft->publish workflow.
- **CLI**: optimize for predictability over forgiveness. `--json` (and `--ndjson` for streams) to stdout with no color/spinners (honor `NO_COLOR`); stable documented exit codes (0 ok; 1-2 user error; 3+ app error); `--dry-run` for mutations; no interactive prompts (or a `--yes`/non-interactive flag); `VIBECMS_*` env with flags-over-env precedence, documented in `--help`; a `vibecms schema` command that dumps each operation's params, required scope, and response shape as JSON (from the committed `openapi.json`) so an agent introspects without external docs. Surface the API error envelope verbatim.
- **API**: every operation carries a description + at least one example in the OpenAPI spec (these flow into the MCP descriptions, the Scalar docs, and `vibecms schema`), plus a stable machine-readable error envelope + rate-limit headers.

## Phases (each gated)

1. **Contract + operation layer**: create `@vc/api-contract` (request/response DTOs, operationIds, scopes, annotations, error envelope, pagination, mappers); extract shared operation functions; refactor `/mcp` `callTool` onto them AND additively enrich each tool with `outputSchema` + `structuredContent` (from the DTOs) + behavior `annotations`, keeping the existing `TextContent` JSON as fallback. Gate: `/mcp` `tools/list` still lists 10 tools (now carrying `outputSchema` + annotations); `posts.create`/`posts.publish` behavior unchanged (structuredContent is additive, no regression); typecheck/build green.
2. **Hono mount**: `routes/api/v1/$.ts` -> `OpenAPIHono` (basePath `/api/v1`), bearer middleware + `enforceApiBudget`, `openapi.json` route. The mount is one line - the TanStack route exposes an `ANY` handler, so `ANY: ({ request }) => app.fetch(request)` delegates the whole `/api/v1/*` subtree to the Hono app (the same request-delegation the Better Auth `$.ts` route already does), with no per-method enumeration. Gate: `GET /api/v1/openapi.json` 200; an authed op works; `/api/auth/$` and existing routes NOT shadowed; OPTIONS/HEAD handled.
3. **REST parity (10 ops)**: sites.get; posts list/search/get/create/update/publish/archive; assets.upload; activity.list - request+response zod, scopes, quota, stable DTOs, error envelope. Keep `GET /api/posts` working (or 308 to `/api/v1/posts`). Gate: per-endpoint authz/scope/tenant-isolation/4xx-envelope verified on dev D1; semantics match MCP.
4. **OpenAPI + docs**: commit generated `openapi.json` with a description + example per operation; serve it + Scalar UI. Add CI gate: regenerate and fail if it differs from the committed file, plus an OpenAPI breaking-change diff step. Gate: spec validates as 3.1; every op has a description + example; CI gate green; docs render.
5. **`@vibecms/cli`** (agent-ergonomic): generate the client from the spec; commands for the core ops + `login`/`whoami` + `schema`. Required: `--json`/`--ndjson` to stdout (no color/spinners, honor `NO_COLOR`); documented stable exit codes; `--dry-run` on mutations; no interactive prompts; `VIBECMS_API_URL`/`VIBECMS_TOKEN` env with flags-over-env precedence. Gate: `npx @vibecms/cli` authed against dev creates + publishes a post; `--json` output parses; `vibecms schema` dumps operations; nonzero exit on error.
6. **Release pipeline**: changesets + CI publish for `@vibecms/cli` only; document supported API-version range. Gate: publish dry-run; version + changelog generated.

## Risks / watch

- **Mount details** (not the concept): do not replace the default server entry; do not use a broad `/api/$` that shadows `/api/auth/$`; define an ANY handler so OPTIONS/HEAD/preflight do not fall through; Hono `basePath`/paths must match the full request URL (`/api/v1`) or every route 404s; `@hono/zod-openapi` JSON-body validation is Content-Type dependent unless the body is marked required.
- **Drift**: if MCP keeps hand-authored JSON Schema (`packages/mcp/src/index.ts:27-88`) while REST uses zod, the two diverge. Mitigation: route both through the shared op layer now; consider deriving MCP tool schemas from the same zod (zod-to-json-schema) in a later pass.
- **Contract-package ceremony**: keep `@vc/api-contract` pure/contract-only; all Cloudflare-bound work stays in `apps/web-next`.
- **DTO leakage**: define stable public DTOs; do not blindly expose internal `@vc/core`/DB fields (`packages/core/src/types.ts:22-51`).

## What NOT to do (solo-founder scope guard)

No OAuth, no published SDK, no custom npm MCP package, no separate API worker, no import/restore, no hand-polished docs site - until REST parity + the spec-diff gate are done. Keep the first release boring: one worker, one CLI, one committed spec, the existing HTTP MCP.

## Versioning / compatibility

`/api/v1` path version from day one; semver `@vibecms/cli` only; MCP protocol version stays an independent axis (`apps/web-next/src/server/mcp.ts:81-82`). Define a stable error envelope + rate-limit headers, a deprecation policy, the CLI's supported API-version range, and self-host base-URL handling.

## Verification gate (per phase + final)

- Per phase: build the touched package/app green + the phase's behavioral smoke.
- Final (deployed dev): authed REST CRUD across the 10 ops with tenant-isolation + scope checks; `openapi.json` served and valid 3.1; Scalar docs load; `/mcp` still 10 tools (no drift); `@vibecms/cli` create+publish against dev; CI spec-diff gate green.
