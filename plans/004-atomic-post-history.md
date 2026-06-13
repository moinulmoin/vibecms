# Plan 004: Make post mutations atomic with versions and activity

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c95b816..HEAD -- packages/core/src/commands/posts.ts packages/core/src/types.ts packages/db/src/repositories/posts.ts packages/db/src/schema.ts packages/db/drizzle apps/web/src/server/cms.ts apps/web/src/server/mcp.ts`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against live code before proceeding; on mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-add-launch-smoke-suite.md recommended
- **Category**: correctness
- **Planned at**: commit `c95b816`, 2026-06-10

## Why this matters

VibeCMS promises that every meaningful post change creates both a version and activity event. Today, post writes, version creation, and activity creation are separate awaited calls. If D1 fails after the post row changes, or if concurrent edits collide on `MAX(version_number)+1`, the app can publish/update content without the promised audit/version trail.

This is core product integrity. It matters even more because agents can write/publish through MCP.

## Current state

- Core commands call repository methods sequentially.
- The D1 repository updates `posts`, then separately computes/inserts `post_versions`, then separately inserts `activity_events`.
- Version numbers are computed with `SELECT COALESCE(MAX(version_number), 0) + 1` outside a transaction.
- `post_versions` has a unique `(post_id, version_number)` constraint.

Excerpts:

```ts
// packages/core/src/commands/posts.ts:21-40
export async function createPost(repo: PostRepository, actor: Actor, input: unknown) {
  requireScope(actor, "posts:create");
  const data = createPostInput.parse(input);
  const post = await repo.createPost(...);
  await repo.createPostVersion(post, actor, "Created post");
  await repo.createActivity({ siteId: post.siteId, actor, action: "post.created", ... });
  return post;
}
```

```ts
// packages/core/src/commands/posts.ts:68-76
const after = await repo.updatePost(input.siteId, input.postId, { status: "published", publishedAt: Math.floor(Date.now() / 1000) }, actor);
if (!after) throw new NotFoundError("Post not found");
await repo.createPostVersion(after, actor, "Published post");
await repo.createActivity({ siteId: after.siteId, actor, action: "post.published", ... });
```

```ts
// packages/db/src/repositories/posts.ts:164-188
const version = await db.prepare(
  "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM post_versions WHERE post_id = ?",
).bind(post.id).first<VersionRow>();
await db.prepare(`INSERT INTO post_versions (...) VALUES (...)`).bind(..., version?.next_version ?? 1, ...).run();
```

Repo conventions: `packages/core` owns validation/scope/business commands; `packages/db` owns D1 SQL. Preserve this layering unless a transaction API requires moving persistence orchestration down into the repository.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Smoke | `pnpm test:smoke:launch` | exit 0 if Plan 001 has landed |

## Scope

**In scope**:
- `packages/core/src/commands/posts.ts`
- `packages/core/src/types.ts` if repository interface changes
- `packages/db/src/repositories/posts.ts`
- `packages/db/src/schema.ts` only if indexes/helpers change
- `packages/db/drizzle/*` only if schema/index migrations are needed
- `apps/web/src/server/cms.ts` and `apps/web/src/server/mcp.ts` only if call signatures change
- Smoke/test scripts from Plan 001 if available

**Out of scope**:
- Changing public post/editor UI.
- Adding version restore UI.
- Changing billing rules.
- Implementing scheduling.

## Git workflow

- Branch: `advisor/004-atomic-post-history`
- Commit message: `fix: make post history writes atomic`
- Do not push unless instructed.

## Steps

### Step 1: Decide transaction boundary with D1

Inspect the current Cloudflare D1 API available in this repo/runtime. Prefer the strongest supported atomic primitive:

- If D1 supports explicit transactions in this environment, use that.
- If only `db.batch` is available and Cloudflare documents it as atomic for D1, use `batch`.
- If neither is truly atomic, implement compensating behavior and conflict retries, but document the limitation in comments and tests.

Do not guess. Read local type definitions or official Cloudflare D1 docs if needed.

**Verify**: record the chosen primitive in a code comment or plan execution note; `pnpm typecheck` must still pass.

### Step 2: Add atomic repository methods

Change the repository contract so each meaningful mutation can persist post + version + activity together. One acceptable shape:

```ts
createPostWithHistory(input, actor, activitySummary): Promise<Post>
updatePostWithHistory(siteId, postId, patch, actor, changeSummary, activityAction): Promise<Post | null>
```

Alternative: keep current names but make `createPost`/`updatePost` accept history metadata. The important invariant: callers cannot update a post without creating the matching version/activity.

Keep core commands responsible for:

- scope checks
- input validation
- billing checks for publish
- choosing change summary/action names

Move persistence ordering and version-number allocation into one repository operation.

**Verify**: `pnpm typecheck` -> expect errors only in call sites you are about to update; after Step 3 it must pass.

### Step 3: Update core commands to use the atomic methods

Update `createPost`, `updatePost`, `publishPost`, and `archivePost` so each command invokes one atomic repository method for persistence.

Preserve current activity action names:

- `post.created`
- `post.updated`
- `post.published`
- `post.archived`

Preserve current change summaries:

- `Created post`
- `Updated post`
- `Published post`
- `Archived post`

**Verify**: `pnpm typecheck && pnpm lint` -> exit 0.

### Step 4: Handle concurrent version allocation

Ensure version allocation cannot leave a changed post without a version.

Preferred behavior:

- allocate `MAX(version_number)+1` inside the same transaction; or
- retry on unique conflict before committing the post update; or
- abort the entire mutation if version insert cannot be allocated.

Do not silently skip version creation. Do not create activity if version creation failed.

**Verify**: add or extend smoke/test coverage if available. At minimum, manually trigger two near-simultaneous updates to the same post and confirm no post update succeeds without a corresponding version count increase.

### Step 5: Add characterization coverage

If Plan 001 exists, extend the smoke to assert:

- after create, version count is 1 and activity contains `post.created`.
- after publish, version count increments and activity contains `post.published`.

If a unit/integration harness exists by then, add tests around a fake repository or local D1. Prefer local D1 integration because the bug is persistence ordering.

**Verify**: `pnpm test:smoke:launch` -> exit 0.

## Test plan

- Mutation happy paths: create, update, publish, archive each produce exactly one new version and one activity event.
- Failure path: simulate version insert failure if possible; assert post row does not change.
- Concurrency path: two updates to same post do not produce duplicate version-number errors after the post row changes.

## Done criteria

- [ ] No core command can update a post without also creating history/activity in the same persistence boundary.
- [ ] Version number allocation is protected against concurrent duplicate numbers or retries safely.
- [ ] Existing MCP/UI post smoke still passes.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm public:audit` exit 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:

- D1 cannot provide transactions/batch semantics strong enough for all-or-nothing post/history writes and no acceptable compensation path is obvious.
- The repository interface change would require a broad architecture rewrite outside the listed files.
- Existing data contains corrupt version sequences that must be repaired before code changes.

## Maintenance notes

Future features such as version restore, import, or collaborative editing must preserve this invariant: content state, version state, and activity state move together or not at all.