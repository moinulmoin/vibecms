# Plan 006: Add workspace API and MCP quotas

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 817fd8c..HEAD -- apps/web/src/server/mcp.ts apps/web/src/worker.tsx apps/web/src/server/api-keys.ts apps/web/src/server/media.ts packages/config/src/index.ts packages/db/src/schema.ts packages/db/drizzle README.md docs/self-hosting.md scripts/smoke-local.sh`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-add-launch-smoke-suite.md recommended, plans/005-harden-mcp-and-rest-contract.md recommended
- **Category**: security, abuse control, cost control
- **Planned at**: commit `817fd8c`, 2026-06-12

## Why this matters

MCP and REST are one agent-facing API surface. MCP wraps the same bearer tokens and domain commands as REST, so billing and abuse accounting must be workspace-level. Token-level limits are useful as a secondary leak guard, but they are not the product limit because owners can create more tokens.

Current controls prevent some damage: bearer scopes, billing gates for writes, token revocation, bounded list sizes, media file size, and media storage caps. They do not stop a leaked token or agent loop from making calls all day, creating drafts, writing activity/version rows, and consuming Worker/D1/R2 budget.

This plan adds one shared budget gate for hosted deployments before public/shared dev access.

## Current state

- `/mcp` parses JSON-RPC, authenticates bearer tokens for `tools/call`, then calls core commands directly.
- `/api/posts` authenticates the same bearer token path and returns bounded post lists.
- `authenticateBearerToken()` returns `actor` and `siteId`, but not `workspaceId`.
- `usage_counters` exists, but no callsite increments or enforces it.
- `usage_counters.site_id` is nullable inside the unique key, so do not rely on `UNIQUE(workspace_id, site_id, period, metric)` for workspace-level rows in SQLite/D1.
- `RateLimitError` already exists in `@vc/core`, but REST currently maps unknown AppError codes to `INTERNAL_ERROR`.
- Deployed dev has `POLAR_WEBHOOK_SECRET` configured. An unsigned webhook probe returned `400`.

Excerpts:

```ts
// apps/web/src/server/mcp.ts:207-213
const auth = await authenticateBearerToken(request);
if (!auth) return rpcError(body.id, -32001, "Unauthorized", 401);
const params = asObject(body.params);
const name = stringParam(params, "name");
if (!name) return rpcError(body.id, -32602, "Tool name is required", 400);
return result(body.id, await callTool(name, auth.actor, auth.siteId, params.arguments));
```

```ts
// apps/web/src/worker.tsx:153-168
const authResult = await authenticateBearerToken(request);
if (!authResult) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
if (!can(authResult.actor, "posts:read")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
const posts = await getPosts(...);
return Response.json({ posts, pagination: { limit, offset, count: posts.length } });
```

```ts
// packages/db/src/schema.ts:154-162
export const usageCounters = sqliteTable("usage_counters", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  siteId: text("site_id").references(() => sites.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  metric: text("metric").notNull(),
  value: integer("value").notNull().default(0),
  ...timestamps,
}, (table) => [uniqueIndex("idx_usage_unique").on(table.workspaceId, table.siteId, table.period, table.metric)]);
```

## Target policy

Hosted only. Self-hosted mode returns no-op from the quota gate.

Workspace-level limits are authoritative:

| Metric | Trial or dev | Paid |
|---|---:|---:|
| Calls per minute | 120 | 120 |
| Calls per day | 5,000 | 25,000 |
| Calls per month | 5,000 | 25,000 |
| Writes per day | 100 | 2,000 |
| Writes per month | 100 | 2,000 |

Secondary token burst cap:

| Metric | Limit |
|---|---:|
| Token calls per minute | 60 |

Accounting rules:

- Count MCP `tools/call` and REST `/api/posts` through the same `api.calls.*` workspace metrics.
- Count authenticated MCP `tools/list` as a call if a bearer token is present.
- Do not count unauthenticated MCP `initialize`, `notifications/initialized`, parse errors, or health GETs.
- Count write tools against write metrics before dispatch: `posts.create`, `posts.update`, `posts.publish`, `posts.archive`, `assets.upload`.
- Count REST `/api/posts` as read-only call volume.
- Keep media byte quota separate from call quota for now. Atomic media reservation is a follow-up P2 unless this plan already touches upload accounting deeply.
- Return `429 RATE_LIMIT` with stable REST JSON and JSON-RPC error shape.

## Implementation steps

### 1. Make token auth return workspace identity

Update `apps/web/src/server/api-keys.ts`:

- Join `api_keys` to `sites` in `authenticateBearerToken()`.
- Return `{ actor, siteId, workspaceId, tokenId }`.
- Preserve current revoked-token behavior.
- Keep `last_used_at` update after a valid token row is found.

Before editing this exported function, run LSP references and update every callsite in one cutover.

### 2. Add central quota constants

Update `packages/config/src/index.ts`:

- Add `API_USAGE_LIMITS` with named trial/dev/paid constants.
- Keep marketing entitlements honest. Replace or clarify `Scoped MCP access` only if product copy implies unlimited API calls.
- Do not introduce token-count pricing. The product limit is workspace call volume.

### 3. Add hosted usage gate

Create `apps/web/src/server/usage.ts` or the nearest existing server module if a better convention exists.

Required exported API:

```ts
export type ApiUsageKind = "read" | "write";

export async function enforceApiBudget(input: {
  workspaceId: string;
  siteId: string;
  tokenId: string;
  kind: ApiUsageKind;
}): Promise<void>;
```

Behavior:

- If `isSelfHosted()` is true, return immediately.
- Load billing status for the workspace or site using existing billing helpers. Use trial/dev limits for `trialing`, `none`, `past_due`, `canceled`, and `unpaid`; use paid limits only for `active`.
- Increment all required counters atomically before request dispatch.
- Use deterministic primary keys, not the nullable unique index:
  - `workspace:${workspaceId}:${metric}:${period}`
  - `token:${tokenId}:${metric}:${period}`
- Use one SQL statement per counter with `ON CONFLICT(id) DO UPDATE ... WHERE value + excluded.value <= limit` and check `meta.changes`.
- Throw `RateLimitError` when a counter cannot be incremented.
- Periods are UTC minute, UTC day, and UTC month strings.

Do not add in-memory limits. Workers are distributed and D1 is the shared source of truth.

### 4. Gate MCP and REST through the same path

Update `apps/web/src/server/mcp.ts`:

- For `tools/list`, if authenticated, call `enforceApiBudget(..., kind: "read")` before returning scoped tools.
- For `tools/call`, classify tool name as read or write, enforce budget after auth and before `callTool()`.
- Map `RATE_LIMIT` to JSON-RPC code `-32010`, HTTP status `429`, message `Rate limit exceeded`.

Update `apps/web/src/worker.tsx`:

- For REST `/api/posts`, call `enforceApiBudget(..., kind: "read")` after auth/scope check and before `getPosts()`.
- Add `RATE_LIMIT` to the safe AppError codes so REST returns `{ "error": "RATE_LIMIT" }` with status `429`.

### 5. Add focused smoke coverage

Update `scripts/smoke-local.sh` or add a small dedicated script only if the existing smoke becomes too noisy.

Required coverage:

- Normal MCP create/publish still succeeds under quota.
- REST `/api/posts` still succeeds under quota.
- A deliberately tiny test quota path returns `429 RATE_LIMIT` for both MCP and REST.

Prefer a test-only env override such as `API_USAGE_TEST_LIMIT=1` over hardcoding production limit exhaustion into smoke.

### 6. Document the accounting model

Update docs only where users or operators need to know:

- `README.md`: MCP and REST share workspace API quotas in hosted mode.
- `docs/self-hosting.md`: self-hosted deployments do not enforce hosted workspace quotas unless the operator configures their own edge limits.

Keep wording short. Do not turn this into pricing copy.

## STOP conditions

Stop and report if any of these happen:

- D1 rejects the conditional upsert shape locally or during deploy.
- `authenticateBearerToken()` cannot cheaply return `workspaceId` without extra per-request queries beyond one join.
- Existing dev data contains `usage_counters` rows that conflict with deterministic IDs.
- Smoke cannot force a tiny limit without changing production defaults.
- Any valid under-limit MCP or REST request starts returning `429`.

## Verification

Run in this order:

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Public audit | `pnpm public:audit` | exit 0 |
| Local smoke | `BASE_URL=http://[::1]:5173 pnpm test:smoke` or current repo smoke command | exit 0 |
| Quota smoke | dedicated tiny-limit command from step 5 | REST and MCP both return 429 after limit |

If deployed, also run the remote smoke against `https://vibecms.moinulislammoin2019.workers.dev` and verify a normal agent flow still works before dogfooding.

## Rollout

1. Land and deploy to dev.
2. Run normal remote smoke.
3. Run one quota-exhaustion probe against a disposable workspace.
4. Watch D1 `usage_counters` rows for the disposable workspace.
5. Keep public launch blocked until this P1 is done if any outside users or shared agent access are allowed.

## Non-goals

- No per-token pricing.
- No OAuth.
- No user-facing usage dashboard in this plan.
- No custom domain abuse protection in this plan.
- No media storage redesign beyond preserving existing caps.

## Done criteria

- MCP and REST consume one shared workspace API budget.
- Token burst limit catches leaked-token loops without becoming the product limit.
- Rate-limit failures are stable and machine-readable.
- Self-hosted mode remains unblocked.
- Smoke proves both normal use and quota denial.
