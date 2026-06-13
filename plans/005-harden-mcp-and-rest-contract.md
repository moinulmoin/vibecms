# Plan 005: Harden MCP and REST contracts for agent-first launch

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c95b816..HEAD -- apps/web/src/server/mcp.ts apps/web/src/worker.tsx packages/validators/src packages/core/src packages/db/src/repositories/posts.ts packages/mcp/src README.md docs/self-hosting.md`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-add-launch-smoke-suite.md recommended
- **Category**: correctness
- **Planned at**: commit `c95b816`, 2026-06-10

## Why this matters

The core product promise is that agents can write, draft, and publish through MCP. A local smoke verified the backend works for happy-path `tools/list`, `posts.create`, `posts.publish`, REST `GET /api/posts`, and export. The contract is still weak for real agents: tool schemas omit validator constraints, invalid input and duplicate slugs return generic/raw errors, list endpoints return unbounded full Markdown bodies, and `tools/list` advertises tools without auth/scope context.

This plan makes the agent surface predictable enough for public alpha without requiring OAuth.

## Current state

- MCP tool schemas are hand-written and minimal.
- Domain validators enforce stricter constraints than MCP schemas advertise.
- MCP catches non-`AppError` exceptions and returns raw `error.message` as JSON-RPC `-32000`.
- REST `GET /api/posts` and MCP `posts.list` return unbounded lists with full `content_markdown`.
- `packages/mcp/src/index.ts` exports only tool names and is not source of truth for schemas.

Excerpts:

```ts
// apps/web/src/server/mcp.ts:13-24
const tools = [
  { name: "sites.get", description: "Get the current site for this token", inputSchema: { type: "object", properties: {} } },
  { name: "posts.list", description: "List posts for the current site", inputSchema: { type: "object", properties: { status: { type: "string" }, search: { type: "string" } } } },
  { name: "posts.create", description: "Create a draft post", inputSchema: { type: "object", properties: { title: { type: "string" }, slug: { type: "string" }, excerpt: { type: "string" }, contentMarkdown: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "slug", "contentMarkdown"] } },
  ...
];
```

```ts
// packages/validators/src/post.ts:3-23
const slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens");
const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([]);
export const createPostInput = z.object({
  siteId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  slug,
  excerpt: z.string().trim().max(500).optional(),
  contentMarkdown: z.string().max(500_000).default(""),
  ...
}).strict();
```

```ts
// apps/web/src/server/mcp.ts:151-155
if (error instanceof AppError) return rpcError(body.id, error.code === "BILLING_REQUIRED" ? -32004 : -32000, error.message, error.status);
const message = error instanceof Error ? error.message : "Tool failed";
if (message.startsWith("Missing required scope") || !can(auth.actor, "posts:read") && name.startsWith("posts.")) return rpcError(body.id, -32003, message, 403);
return rpcError(body.id, -32000, message);
```

```ts
// packages/db/src/repositories/posts.ts:155-159
await db.prepare(
  `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
    tags_json, created_at, updated_at
  FROM posts WHERE site_id = ? ORDER BY updated_at DESC`,
).bind(input.siteId).all<PostRow>()
```

Repo conventions: validators live in `@vc/validators`; core commands parse unknown input with Zod; MCP is remote HTTP JSON-RPC with bearer tokens; REST is read/list only.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Public audit | `pnpm public:audit` | exit 0 |
| Smoke | `pnpm test:smoke:launch` | exit 0 if Plan 001 has landed |

## Scope

**In scope**:
- `apps/web/src/server/mcp.ts`
- `apps/web/src/worker.tsx` for REST query parsing only
- `packages/validators/src/post.ts` if list pagination schema is added
- `packages/core/src/commands/posts.ts` and `packages/core/src/types.ts` if list return/input types change
- `packages/db/src/repositories/posts.ts`
- `packages/mcp/src/index.ts` if shared tool metadata is introduced
- README/docs snippets if response shape changes

**Out of scope**:
- OAuth. Token auth remains acceptable for alpha.
- Adding REST write routes.
- Building a full SDK package.
- Changing UI dashboard list behavior unless it uses the same repository list and must adapt.

## Git workflow

- Branch: `advisor/005-mcp-rest-contract`
- Commit message: `fix: harden mcp and rest contracts`
- Do not push unless instructed.

## Steps

### Step 1: Create one tool metadata source of truth

Move MCP tool definitions to a shared location, preferably `packages/mcp/src/index.ts`, or at least structure them in `apps/web/src/server/mcp.ts` so names, descriptions, required scopes, and schemas are centralized.

Each tool definition should include:

- `name`
- `description`
- `requiredScope`
- `inputSchema` with JSON Schema constraints

Add constraints matching validators:

- slug pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 120
- title max 160
- excerpt max 500
- contentMarkdown max 500000
- tags max 20, item max 40
- status enum `draft | published | archived`
- asset MIME enum `image/jpeg | image/png | image/webp | image/gif`
- upload size guidance in description (base64 payload represents max 10MB decoded file)
- `additionalProperties: false` where appropriate

**Verify**: `pnpm typecheck` -> exit 0.

### Step 2: Improve MCP error mapping

Update `handleMcpRequest` catch logic:

- `FORBIDDEN` -> JSON-RPC `-32003`, HTTP 403
- `BILLING_REQUIRED` -> `-32004`, HTTP 402
- `NOT_FOUND` -> stable app code such as `-32005`, HTTP 404
- `CONFLICT`/duplicate slug -> stable app code such as `-32009`, HTTP 409
- Zod validation errors -> `-32602 Invalid params`, HTTP 400 or 200 depending on JSON-RPC convention chosen for this app
- unknown errors -> generic `Tool failed`, do not return raw driver/stack messages

Preserve enough field-level validation detail for agents, but avoid leaking raw D1/R2/SDK internals.

**Verify**: manually call MCP `posts.create` with invalid slug and duplicate slug. Invalid slug should return stable invalid-params; duplicate slug should return stable conflict; neither should include raw D1 SQL text.

### Step 3: Authenticate or annotate `tools/list`

Preferred: authenticate `tools/list` and filter/annotate tools by token scopes. If compatibility requires unauthenticated `tools/list`, keep it but include required-scope hints in descriptions and docs.

Minimum alpha behavior:

- `tools/list` returns each tool with clear `Requires scope: ...` in description.
- `tools/call` returns `-32003` for insufficient scope.

Better behavior:

- `tools/list` authenticates bearer token when present and returns `available: true/false` or filters unavailable mutating tools.

**Verify**: create a token without `posts:publish`; `tools/call posts.publish` returns forbidden with stable code.

### Step 4: Add pagination and summary list shape

Do not return unbounded full Markdown bodies from list endpoints.

Introduce list parameters:

- `limit` default 20, max 100
- `cursor` or `offset` (cursor preferred)
- optional `status`, `search`

For list responses, prefer summaries without full `contentMarkdown`. Keep `posts.get` for full content. Apply consistently to:

- MCP `posts.list`
- MCP `posts.search`
- REST `GET /api/posts`

If changing response shape is too risky for one plan, add pagination first but keep body until a follow-up. Do not leave unbounded list queries.

**Verify**: seed/create >25 posts and confirm default list returns 20 or configured limit with continuation metadata.

### Step 5: Update docs and smoke

Update README/settings snippets only if method names/response shapes changed. Extend Plan 001 smoke to cover:

- `tools/list` includes required-scope hints or respects token scopes.
- invalid slug returns `-32602`.
- duplicate slug returns stable conflict.
- list supports `limit`.

**Verify**: `pnpm test:smoke:launch` -> exit 0.

## Test plan

- Happy paths: `initialize`, `tools/list`, `posts.create`, `posts.publish`, `posts.list`, REST list.
- Error paths: invalid slug, duplicate slug, missing scope, missing token, unknown tool.
- Pagination path: default limit and explicit small limit.
- Security path: raw internal DB errors are not returned.

## Done criteria

- [ ] MCP schemas include validator-equivalent constraints and scope hints.
- [ ] MCP validation, forbidden, not-found, conflict, billing, and unknown errors map to stable JSON-RPC errors.
- [ ] Unknown errors do not expose raw internal messages.
- [ ] `posts.list`/REST list are bounded by default.
- [ ] Full Markdown bodies are obtained through `posts.get` or an intentional documented list shape.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm public:audit` exit 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- Existing MCP clients rely on unbounded full-body `posts.list` and there is no acceptable compatibility path.
- JSON Schema generation from Zod introduces a new dependency with unacceptable bundle/build impact.
- MCP protocol compatibility requires unauthenticated `tools/list`; in that case annotate rather than authenticate.

## Maintenance notes

Agent usability depends on the schemas staying truthful. Whenever validators change, MCP schemas and docs must change in the same PR unless generated from the same source.