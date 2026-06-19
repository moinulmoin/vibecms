# 011 - Post version history: list / view / restore

Written against commit `92dbc42`. Status: DONE (shipped in `f3eb41b`; full list/view/restore round-trip verified on dev via the REST agent surface).

## Finding (validated)

Every create/update/publish writes a row to `post_versions` via `postVersionStatement` (`packages/db/src/repositories/posts.ts:91-112`), capturing the full post snapshot + `version_number` + `change_summary` + actor. But there is **no read/list/restore path on any surface**: no method on `PostRepository` (`packages/core/src/commands/posts.ts:12-19`), no core command, no operation in `packages/api-contract`, no MCP tool (`packages/mcp/src/index.ts`), no REST route, no CLI command, no dashboard UI. The editor even promises "keep every save versioned for rollback and audit history" (`PostEditorPage.tsx`) with no way to act on it. This is the marquee built-but-hidden feature and the core of the agent-trust / audit story.

## Scope

Add three capabilities, scope-gated, across all surfaces in parity (the product rule: UI/MCP/REST share core commands):

1. **Repo** (`packages/db/src/repositories/posts.ts`): `listPostVersions(siteId, postId)` → version summaries (number, title, status, change_summary, actor, created_at); `getPostVersion(siteId, postId, versionNumber)` → full snapshot. Add both to the `PostRepository` type in core.
2. **Core** (`packages/core/src/commands/posts.ts`): `listPostVersions`/`getPostVersion` (require `posts:read`); `restorePostVersion` (require `posts:update`) = load the target version, then `updatePostWithHistory` with that snapshot as the patch and `changeSummary: "Restored to v{n}"`, `activityAction: "post.restored"` (creates a new version + activity - restore is forward-only, never destructive).
3. **api-contract + server operations + mcp-dispatch + REST routes**: expose `posts.versions.list`, `posts.versions.get`, `posts.versions.restore` (MCP) and `GET /posts/:id/versions`, `GET /posts/:id/versions/:n`, `POST /posts/:id/versions/:n/restore` (REST). Validate args with new request schemas.
4. **Dashboard**: a "Version history" panel/drawer in `PostEditorPage` - list versions (number, who, when, change summary), view a version (read-only), and a Restore action (confirm) that calls the restore mutation and reloads.
5. **CLI** (optional, follow-up): `vibecms posts versions <postId>` + `restore`.

Restore must respect the billing/publish gate semantics (restoring does not publish; it restores content + status snapshot, but never moves draft→published past the free cap - keep restore as an `updatePost`-class operation, not publish).

## Done criteria

- Versions are listable/viewable/restorable from the dashboard, MCP, and REST; each restore creates a new version + a `post.restored` activity event.
- Multi-tenant: version reads/restores are scoped by `siteId` (no cross-site access).
- `pnpm -r typecheck` passes; deploy + verify a restore round-trip on dev.vibecms.dev.

## Codex review resolutions (these supersede any ambiguity above)

1. **Restore is content-only; it never changes status/published_at.** The restore patch contains exactly: `title, slug, excerpt, contentMarkdown, coverAssetId, seoTitle, seoDescription, tags` from the target version snapshot. It explicitly EXCLUDES `id`, `site_id`, `version_number`, `created_at`, `status`, and `published_at`. The live post keeps its current status. This removes the contradiction and the billing concern.
2. **No billing-gate interaction.** Because restore never moves draft->published, the free-publish cap is never touched. Restore is strictly an `updatePost`-class operation (requires `posts:update`), never a publish.
3. **Concurrency: reuse the existing contract.** `updatePostWithHistory` already creates the next version via `COALESCE(MAX(version_number))+1` guarded by the `idx_post_versions_post_number` unique index; `normalizeD1Error` maps the race to `ConflictError` ("Post changed concurrently; retry the save"). Restore inherits this - on a concurrent race it returns a 409/conflict and the client retries. No new locking needed.
4. **Cross-tenant: enforce at the SQL level.** Every version query (`listPostVersions`, `getPostVersion`) and the restore read MUST include `AND site_id = ?` in the WHERE clause - not just a `siteId` parameter in the repo signature. Restore loads the version via `getPostVersion(siteId, postId, n)` and then writes via the existing site-scoped `updatePostWithHistory(siteId, postId, ...)`.
5. **SEO round-trips.** `post_versions` now carries `seo_title`/`seo_description` (commit 674ee95). The version list/get DTOs (api-contract + dashboard) must expose them, and the restore patch (resolution 1) includes them so SEO is restored faithfully.
6. **Version DTO**: add a `postVersionDtoSchema` (versionNumber, title, slug, status, changeSummary, actorType, actorName, createdAt) for list; full snapshot for get. Keep `siteId` out of the DTO (same as `mapPost`).
