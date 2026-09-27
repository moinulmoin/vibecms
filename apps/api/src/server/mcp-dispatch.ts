import type { McpToolName } from "@vc/api-contract";
import {
  archivePostRequestSchema,
  unarchivePostRequestSchema,
  createPostRequestSchema,
  deleteAssetRequestSchema,
  updateAssetRequestSchema,
  getAssetRequestSchema,
  getFormatGuideRequestSchema,
  getPostRequestSchema,
  getPostBySlugRequestSchema,
  getPostVersionRequestSchema,
  getSiteRequestSchema,
  listActivityRequestSchema,
  listAssetsRequestSchema,
  listPostsRequestSchema,
  listPostVersionsRequestSchema,
  previewPostRequestSchema,
  publishPostRequestSchema,
  schedulePostRequestSchema,
  unschedulePostRequestSchema,
  rotatePostPreviewRequestSchema,
  restorePostVersionRequestSchema,
  searchPostsRequestSchema,
  updatePostRequestSchema,
  uploadAssetRequestSchema,
  updateSiteRequestSchema, getThemeRequestSchema, updateThemeRequestSchema, revertThemeRequestSchema,
  updateVoiceRequestSchema, updateSignupFormRequestSchema, listTagsRequestSchema, getAnalyticsRequestSchema,
} from "@vc/api-contract";
import type { OperationContext } from "./operations";
import {
  archivePostOp,
  unarchivePostOp,
  createPostOp,
  deleteAssetOp,
  updateAssetOp,
  getAssetOp,
  getFormatGuideOp,
  getPostOp,
  getPostBySlugOp,
  getPostVersionOp,
  getSiteOp,
  listActivityOp,
  listAssetsOp,
  listPostsOp,
  listPostVersionsOp,
  previewPostOp,
  publishPostOp,
  schedulePostOp,
  unschedulePostOp,
  rotatePostPreviewOp,
  restorePostVersionOp,
  searchPostsOp,
  updatePostOp,
  uploadAssetOp,
  updateSiteOp, getThemeOp, updateThemeOp, revertThemeOp, updateVoiceOp, updateSignupFormOp, listTagsOp, getAnalyticsOp,
} from "./operations";

export async function dispatchOperation(toolName: McpToolName, ctx: OperationContext, rawArguments: unknown) {
  switch (toolName) {
    case "sites.get":
      getSiteRequestSchema.parse(rawArguments ?? {});
      return getSiteOp(ctx);
    case 'sites.update':
      return updateSiteOp(ctx, updateSiteRequestSchema.parse(rawArguments ?? {}));
    case 'sites.theme.get':
      getThemeRequestSchema.parse(rawArguments ?? {});
      return getThemeOp(ctx);
    case 'sites.theme.update':
      return updateThemeOp(ctx, updateThemeRequestSchema.parse(rawArguments ?? {}));
    case 'sites.theme.revert':
      return revertThemeOp(ctx, revertThemeRequestSchema.parse(rawArguments ?? {}));
    case 'sites.voice.update':
      return updateVoiceOp(ctx, updateVoiceRequestSchema.parse(rawArguments ?? {}));
    case 'sites.signup_form.update':
      return updateSignupFormOp(ctx, updateSignupFormRequestSchema.parse(rawArguments ?? {}));
    case 'tags.list':
      listTagsRequestSchema.parse(rawArguments ?? {});
      return listTagsOp(ctx);
    case 'analytics.get':
      return getAnalyticsOp(ctx, getAnalyticsRequestSchema.parse(rawArguments ?? {}));
    case "posts.list":
      return listPostsOp(ctx, listPostsRequestSchema.parse(rawArguments ?? {}));
    case "posts.search":
      return searchPostsOp(ctx, searchPostsRequestSchema.parse(rawArguments ?? {}));
    case "posts.get":
      return getPostOp(ctx, getPostRequestSchema.parse(rawArguments ?? {}));
    case "posts.get_by_slug":
      return getPostBySlugOp(ctx, getPostBySlugRequestSchema.parse(rawArguments ?? {}));
    case "posts.create":
      return createPostOp(ctx, createPostRequestSchema.parse(rawArguments ?? {}));
    case "posts.update":
      return updatePostOp(ctx, updatePostRequestSchema.parse(rawArguments ?? {}));
    case "posts.publish":
      return publishPostOp(ctx, publishPostRequestSchema.parse(rawArguments ?? {}));
    case "posts.schedule":
      return schedulePostOp(ctx, schedulePostRequestSchema.parse(rawArguments ?? {}));
    case "posts.unschedule":
      return unschedulePostOp(ctx, unschedulePostRequestSchema.parse(rawArguments ?? {}));
    case "posts.preview.rotate":
      return rotatePostPreviewOp(ctx, rotatePostPreviewRequestSchema.parse(rawArguments ?? {}));
    case "posts.archive":
      return archivePostOp(ctx, archivePostRequestSchema.parse(rawArguments ?? {}));
    case "posts.unarchive":
      return unarchivePostOp(ctx, unarchivePostRequestSchema.parse(rawArguments ?? {}));
    case "assets.upload":
      return uploadAssetOp(ctx, uploadAssetRequestSchema.parse(rawArguments ?? {}));
    case "assets.list":
      listAssetsRequestSchema.parse(rawArguments ?? {});
      return listAssetsOp(ctx);
    case "assets.get":
      return getAssetOp(ctx, getAssetRequestSchema.parse(rawArguments ?? {}));
    case "assets.update":
      return updateAssetOp(ctx, updateAssetRequestSchema.parse(rawArguments ?? {}));
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
