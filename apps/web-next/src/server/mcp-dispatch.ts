import type { McpToolName } from "@vc/api-contract";
import {
  archivePostRequestSchema,
  createPostRequestSchema,
  getPostRequestSchema,
  getSiteRequestSchema,
  listActivityRequestSchema,
  listPostsRequestSchema,
  publishPostRequestSchema,
  searchPostsRequestSchema,
  updatePostRequestSchema,
  uploadAssetRequestSchema,
} from "@vc/api-contract";
import type { OperationContext } from "./operations";
import {
  archivePostOp,
  createPostOp,
  getPostOp,
  getSiteOp,
  listActivityOp,
  listPostsOp,
  publishPostOp,
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
    case "activity.list":
      return listActivityOp(ctx, listActivityRequestSchema.parse(rawArguments ?? {}));
    default:
      throw new Error(`Unknown tool: ${String(toolName)}`);
  }
}