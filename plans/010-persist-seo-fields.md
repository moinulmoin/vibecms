# 010 - Persist SEO fields (seoTitle / seoDescription) end-to-end

Written against commit `92dbc42`. Status: DONE (threaded end-to-end; `pnpm -r typecheck` clean; read side `public-blog-data.ts:89,101` already selects the columns).

## Finding (validated)

`seoTitle` / `seoDescription` are accepted by validators (`packages/validators/src/post.ts:18-19,31-32,48-49`), the `posts` and `post_versions` tables both have `seo_title` / `seo_description` / `canonical_url` columns (`packages/db/src/schema.ts:61-63,87-89`), the JSON export reads them (`apps/web-next/src/server/export.ts:44,59-60`), and the public blog renders `post.seo_title` / `seo_description`. BUT the write path drops them on the floor:

- `packages/core/src/types.ts:22-35` - `Post` type has no SEO fields.
- `packages/core/src/commands/posts.ts:28-39,52-59` - `createPost`/`updatePost` build the post input/patch without SEO.
- `packages/db/src/repositories/posts.ts:3-16,35-50,91-112,145-208` - `PostRow`, `mapPost`, the version snapshot INSERT, and the posts INSERT/UPDATE all omit SEO columns.
- `apps/web-next/src/server/posts-page-fn.ts` - create/update mutations don't forward SEO.
- `apps/web-next/src/components/dashboard/PostEditorPage.tsx` - editor form has no SEO inputs.

Net: `seo_title`/`seo_description` are always NULL; the public blog silently falls back to title/excerpt. `plans/README.md` flagged this as an open decision → decision: make SEO first-class. No DB migration needed (columns already exist).

## Scope

Thread `seoTitle: string | null` and `seoDescription: string | null` through: core `Post` type → `createPost`/`updatePost` → repo (`PostRow`, `mapPost`, posts INSERT/UPDATE, version-snapshot INSERT) → api-contract Post DTO → `posts-page-fn` mutations → editor UI (SEO inputs in the Publish Settings panel + `payloadFromForm`). `canonicalUrl` is out of scope for now (no validator/UI yet).

`PostSummary` stays SEO-free (`Omit` SEO too) so list queries are untouched.

## Done criteria

- Editor shows "SEO title" (max 70) + "SEO description" (max 180) inputs; saving persists them.
- A published post with custom SEO renders those values in `<title>`/meta on the public blog.
- `pnpm --filter @vc/web-next typecheck` and `pnpm -r typecheck` pass.
- Deploy to dev.vibecms.dev; verify edit→save→public meta.
