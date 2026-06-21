# 019 - Media asset parity (list / get / delete)

Status: DONE - shipped to dev 2026-06-21 (worker `ae139399`). Built via parallel subagents (contract keystone -> MCP/REST + CLI + dashboard consumers). Gates green (typecheck/lint/audit/build, 36 node + 7 isolation tests); verified end-to-end on dev across REST, MCP, and CLI. Roadmap item #4 (agent-first media asymmetry).

## Goal
Agents and humans could `upload` image assets but could not `list`, `get`, or `delete` them - an agent-first asymmetry for a CMS whose primary authors are agents. Add the three missing operations across every surface, with safe deletion semantics.

## What shipped
- New operations `assets.list`, `assets.get`, `assets.delete` on:
  - MCP tools (`packages/mcp/src/index.ts`, `apps/web-next/src/server/mcp-dispatch.ts`; `assets.delete` added to the write-metering set).
  - REST (`GET /api/v1/assets`, `GET /api/v1/assets/{assetId}`, `DELETE /api/v1/assets/{assetId}`).
  - CLI `@vibecms/cli` (`assets list`, `assets get <id>`, `assets delete <id>`; 409 surfaced as the CONFLICT exit code).
  - Dashboard Media page: a confirm-gated Delete per asset (`MediaPage.tsx` + `deleteAssetForApp` in `media.ts` + a CSRF/auth-guarded `POST /api/media/delete` route).
- Contract keystone: `getAsset`/`deleteAsset` core commands + `AssetRepository.deleteAsset`/`isAssetReferencedAsCover` (db), `list/get/delete` request schemas + operation registry entries (`@vc/api-contract`). Reused the existing `assetDtoSchema` + `mapAsset`.

## Decisions
- SCOPE: all three gate on the existing `assets:write` (no `assets:read` - every media-touching role already has write; the existing `listAssets` already required write). list/get meter as reads, delete as a write.
- DELETE semantics: site-scoped; deletes the D1 row first, then best-effort deletes the R2 object (an orphaned object never fails the op). BLOCKED with `CONFLICT` if any post in the site references the asset as `cover_asset_id`; inline Markdown image refs stay best-effort (cannot FK markdown).
- NO migration: the `assets` table + `posts.cover_asset_id` already existed.
- The agent REST/MCP create/update API still does NOT expose `coverAssetId` (cover is a dashboard-only concept) - unchanged here; the CONFLICT path was verified by referencing an asset at the DB level.

## Verification (dev, worker ae139399)
- REST: upload (201) -> list (both) -> get (200) -> delete unreferenced (200) -> get (404) -> public `/media-assets/{id}` (404, R2 gone).
- REST CONFLICT: delete a cover-referenced asset -> 409 `{code: CONFLICT}`, asset preserved; after clearing the reference -> 200.
- MCP: `tools/list` exposes assets.list/get/delete; CLI: full upload -> list -> get -> delete -> NOT_FOUND cycle green.
- Dashboard: `POST /api/media/delete` returns 403 unauthenticated (CSRF/auth-guarded, route registered); UI + route verified by build + the shared proven core delete (no full browser OTP click-through).

## Deferred
- `assets:read` scope + a view-only media role (only if a non-writing media role appears).
- Pagination on `assets.list` (v1 returns all site assets, newest first; blog media is bounded).
- Exposing `coverAssetId` on the agent create/update API.
- A full browser OTP click-through of the dashboard delete.
