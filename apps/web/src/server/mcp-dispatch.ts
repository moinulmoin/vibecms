import type { McpToolName } from "@vc/api-contract";
import {
  archivePostRequestSchema,
  createPostRequestSchema,
  deleteAssetRequestSchema,
  getAssetRequestSchema,
  getFormatGuideRequestSchema,
  getPostRequestSchema,
  getPostVersionRequestSchema,
  getSiteRequestSchema,
  listActivityRequestSchema,
  listAssetsRequestSchema,
  listPostsRequestSchema,
  listPostVersionsRequestSchema,
  previewPostRequestSchema,
  publishPostRequestSchema,
  restorePostVersionRequestSchema,
  searchPostsRequestSchema,
  updatePostRequestSchema,
  uploadAssetRequestSchema,
} from "@vc/api-contract";
import type { OperationContext } from "./operations";
import {
  archivePostOp,
  createPostOp,
  deleteAssetOp,
  getAssetOp,
  getFormatGuideOp,
  getPostOp,
  getPostVersionOp,
  getSiteOp,
  listActivityOp,
  listAssetsOp,
  listPostsOp,
  listPostVersionsOp,
  previewPostOp,
  publishPostOp,
  restorePostVersionOp,
  searchPostsOp,
  updatePostOp,
  uploadAssetOp,
} from "./operations";

export async function dispatchOperation(toolName: McpToolName, ctx: OperationContext, rawArguments: unknown) {
  switch (toolName) {
    case "sites.get":
      getSiteRequestSchema.parse(rawArguments ?? {});
      return getSiteOp(ctx);
    case "posts.list":
      return listPostsOp(ctx, listPostsRequestSchema.parse(rawArguments ?? {}));
    case "posts.search":
      return searchPostsOp(ctx, searchPostsRequestSchema.parse(rawArguments ?? {}));
    case "posts.get":
      return getPostOp(ctx, getPostRequestSchema.parse(rawArguments ?? {}));
    case "posts.create":
      return createPostOp(ctx, createPostRequestSchema.parse(rawArguments ?? {}));
    case "posts.update":
      return updatePostOp(ctx, updatePostRequestSchema.parse(rawArguments ?? {}));
    case "posts.publish":
      return publishPostOp(ctx, publishPostRequestSchema.parse(rawArguments ?? {}));
    case "posts.archive":
      return archivePostOp(ctx, archivePostRequestSchema.parse(rawArguments ?? {}));
    case "assets.upload":
      return uploadAssetOp(ctx, uploadAssetRequestSchema.parse(rawArguments ?? {}));
    case "assets.list":
      listAssetsRequestSchema.parse(rawArguments ?? {});
      return listAssetsOp(ctx);
    case "assets.get":
      return getAssetOp(ctx, getAssetRequestSchema.parse(rawArguments ?? {}));
    case "assets.delete":
      return deleteAssetOp(ctx, deleteAssetRequestSchema.parse(rawArguments ?? {}));
    case "activity.list":
      return listActivityOp(ctx, listActivityRequestSchema.parse(rawArguments ?? {}));
    case "posts.versions.list":
      return listPostVersionsOp(ctx, listPostVersionsRequestSchema.parse(rawArguments ?? {}));
    case "posts.versions.get":
      return getPostVersionOp(ctx, getPostVersionRequestSchema.parse(rawArguments ?? {}));
    case "posts.versions.restore":
      return restorePostVersionOp(ctx, restorePostVersionRequestSchema.parse(rawArguments ?? {}));
    case "posts.format_guide":
      return await getFormatGuideOp(ctx, getFormatGuideRequestSchema.parse(rawArguments ?? {}));
    case "posts.preview":
      return await previewPostOp(ctx, previewPostRequestSchema.parse(rawArguments ?? {}));
    default:
      throw new Error(`Unknown tool: ${String(toolName)}`);
  }
}