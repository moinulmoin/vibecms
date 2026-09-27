import type { Scope } from "@vc/core";
import { z } from "zod";
import {
  activityDtoSchema,
  assetDtoSchema,
  formatGuideDtoSchema,
  postDtoSchema,
  postSummaryDtoSchema,
  postVersionDtoSchema,
  postVersionSummaryDtoSchema,
  previewPostDtoSchema,
  siteWithSignupFormDtoSchema,
  updatedSiteDtoSchema, themeDtoSchema, voiceSettingsDtoSchema, signupFormDtoSchema,
  signupFormUpdateDtoSchema, tagDtoSchema, analyticsDtoSchema,
} from "./dto";
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
} from "./requests";

export type OperationAnnotations = {
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
};

export type OperationDefinition = {
  /** MCP tool name (stable). */
  toolName: string;
  /** OpenAPI-style operation id. */
  operationId: string;
  requiredScope: Scope;
  description: string;
  requestSchema: z.ZodTypeAny;
  responseSchema: z.ZodTypeAny;
  annotations: OperationAnnotations;
};

const scopeSuffix = (scope: Scope) => ` Requires scope: ${scope}.`;

function opDescription(body: string, scope: Scope, _errors: string) {
  return `${body}${scopeSuffix(scope)}`.trim();
}

const readErrors =
  "Returns NOT_FOUND when a resource is missing; VALIDATION_ERROR when input is invalid; FORBIDDEN without scope; RATE_LIMIT when the workspace budget is exceeded.";
const writeErrors =
  `${readErrors} CONFLICT when a slug is already in use; BILLING_REQUIRED when a paid subscription is required.`;

export const operations = [
  {
    toolName: "sites.get",
    operationId: "getSite",
    requiredScope: "sites:read",
    description: opDescription(
      "Get the current site for this token, including its voice profile revision and signup form settings.",
      "sites:read",
      readErrors,
    ),
    requestSchema: getSiteRequestSchema,
    responseSchema: siteWithSignupFormDtoSchema.nullable(),
    annotations: { readOnly: true },
  },
  {
    toolName: 'sites.update', operationId: 'updateSite', requiredScope: 'site:write',
    description: opDescription('Change only the sent site fields, such as name, byline, SEO, images, navigation, or social links. First read sites.get and send its updatedAt as expectedUpdatedAt; stale values return CONFLICT. Example: {"expectedUpdatedAt": 123, "name": "Field Notes"}. Live change: needs explicit owner approval first (see server instructions).', 'site:write', writeErrors),
    requestSchema: updateSiteRequestSchema, responseSchema: updatedSiteDtoSchema, annotations: { idempotent: true },
  },
  {
    toolName: 'sites.theme.get', operationId: 'getSiteTheme', requiredScope: 'site:write',
    description: opDescription('Read the current blog template and look, plus allowed values with human names. Use its updatedAt for a theme update. Example: {}.', 'site:write', readErrors),
    requestSchema: getThemeRequestSchema, responseSchema: themeDtoSchema, annotations: { readOnly: true },
  },
  {
    toolName: 'sites.theme.update', operationId: 'updateSiteTheme', requiredScope: 'site:write',
    description: opDescription('Change any part of the blog look. Templates: minimal (Minimal), editorial (Editorial), technical (Notebook), product (Magazine); display names are accepted too. A new template applies its curated accent, font, radius, width, and mode unless keepLook=true. Example: {"expectedUpdatedAt": 123, "template": "editorial", "keepLook": true}. The previous look is saved for one-step revert; changes are live immediately. Live change: needs explicit owner approval first (see server instructions).', 'site:write', writeErrors),
    requestSchema: updateThemeRequestSchema, responseSchema: themeDtoSchema, annotations: {},
  },
  {
    toolName: 'sites.theme.revert', operationId: 'revertSiteTheme', requiredScope: 'site:write',
    description: opDescription('Undo the last theme change and restore the exact previous look only when sites.theme.get.canRevert is true. Intervening site-setting changes can invalidate the saved revert. Example: {"expectedUpdatedAt": 124}. Live change: needs explicit owner approval first (see server instructions).', 'site:write', writeErrors),
    requestSchema: revertThemeRequestSchema, responseSchema: themeDtoSchema, annotations: {},
  },
  {
    toolName: 'sites.voice.update', operationId: 'updateSiteVoice', requiredScope: 'site:write',
    description: opDescription('Replace the writing profile. First read sites.get.voiceProfile; preserve existing fields unless the owner requested changes. Send its revision as expectedUpdatedAt (zero means never configured). Concurrent edits return CONFLICT. Example: {"expectedUpdatedAt":0,"audience":"Developers","tone":"Clear","doRules":["Use examples"],"dontRules":[],"representativePostIds":[]}. Live change: needs explicit owner approval first (see server instructions).', 'site:write', writeErrors),
    requestSchema: updateVoiceRequestSchema, responseSchema: voiceSettingsDtoSchema, annotations: {},
  },
  {
    toolName: 'sites.signup_form.update', operationId: 'updateSignupForm', requiredScope: 'site:write',
    description: opDescription('Read the current signup form from sites.get and its updatedAt first. Update only supplied fields. Example: {"expectedUpdatedAt":123,"enabled":true,"heading":"Get new posts"}. Returns the updated form. Concurrent changes return CONFLICT. Live change: needs explicit owner approval first (see server instructions).', 'site:write', writeErrors),
    requestSchema: updateSignupFormRequestSchema, responseSchema: signupFormUpdateDtoSchema, annotations: {},
  },
  {
    toolName: 'tags.list', operationId: 'listTags', requiredScope: 'site:write',
    description: opDescription('List tags currently used by non-archived posts and their post counts. Reuse these spellings when tagging a post. Example: {}.', 'site:write', readErrors),
    requestSchema: listTagsRequestSchema, responseSchema: z.array(tagDtoSchema), annotations: { readOnly: true },
  },
  {
    toolName: 'analytics.get', operationId: 'getAnalytics', requiredScope: 'analytics:read',
    description: opDescription('Read aggregate views, trend, top posts, referrers, AI referrals, and crawler requests. Example: {"range":"30"}; ranges: 7, 30, 90, 365, all. No visitor data. Free plans return ANALYTICS_PAID_PLAN.', 'analytics:read', readErrors),
    requestSchema: getAnalyticsRequestSchema, responseSchema: analyticsDtoSchema, annotations: { readOnly: true },
  },
  {
    toolName: "posts.list",
    operationId: "listPosts",
    requiredScope: "posts:read",
    description: opDescription(
      "List bounded post summaries for the current site. Use posts.get for full Markdown.",
      "posts:read",
      readErrors,
    ),
    requestSchema: listPostsRequestSchema,
    responseSchema: z.array(postSummaryDtoSchema),
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.search",
    operationId: "searchPosts",
    requiredScope: "posts:read",
    description: opDescription(
      "Search bounded post summaries by title, slug, or excerpt. Use posts.get for full Markdown.",
      "posts:read",
      readErrors,
    ),
    requestSchema: searchPostsRequestSchema,
    responseSchema: z.array(postSummaryDtoSchema),
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.get",
    operationId: "getPost",
    requiredScope: "posts:read",
    description: opDescription(
      "Get one post by id, including full Markdown, currentVersionNumber, and previewUrl. previewUrl is a secret bearer link to the current saved tip, not an immutable version. Share only with the owner or explicitly authorized reviewers; never put it in public content. Rotate it if exposed.",
      "posts:read",
      readErrors,
    ),
    requestSchema: getPostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.get_by_slug",
    operationId: "getPostBySlug",
    requiredScope: "posts:read",
    description: opDescription(
      "Get one post by its exact slug, including full Markdown.",
      "posts:read",
      readErrors,
    ),
    requestSchema: getPostBySlugRequestSchema,
    responseSchema: postDtoSchema,
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.create",
    operationId: "createPost",
    requiredScope: "posts:create",
    description: opDescription(
      "Create a draft post from a Markdown body. Returns id, currentVersionNumber, and previewUrl. Omitted presentation uses the active preset default layout; call posts.format_guide for supportedLayouts. previewUrl is a secret bearer link to the current saved tip, not an immutable version. Share only with the owner or explicitly authorized reviewers; never put it in public content. Rotate it if exposed.",
      "posts:create",
      writeErrors,
    ),
    requestSchema: createPostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: {},
  },
  {
    toolName: "posts.update",
    operationId: "updatePost",
    requiredScope: "posts:update",
    description: opDescription(
      "Update a post. Provide postId, expectedVersionNumber (current tip), and only the fields to change; contentMarkdown is the full Markdown body. Stale expectedVersionNumber returns CONFLICT.",
      "posts:update",
      writeErrors,
    ),
    requestSchema: updatePostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: { idempotent: true },
  },
  {
    toolName: "posts.publish",
    operationId: "publishPost",
    requiredScope: "posts:publish",
    description: opDescription(
      "Publish exactly the approved draft version. After owner approval, pass posts.get.currentVersionNumber as expectedVersionNumber. The approved version must still be current; a newer edit returns CONFLICT without publishing. Live change: needs explicit owner approval first (see server instructions).",
      "posts:publish",
      writeErrors,
    ),
    requestSchema: publishPostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: {},
  },
  {
    toolName: "posts.schedule",
    operationId: "schedulePost",
    requiredScope: "posts:publish",
    description: opDescription(
      "Schedule an approved saved version. versionNumber selects the approved saved version; it is not a current-tip precondition. publishAt accepts Unix seconds or an ISO-8601 UTC string ending in Z or an explicit offset. Approve that exact version and time; later edits do not alter it. Live change: needs explicit owner approval first (see server instructions).",
      "posts:publish", writeErrors,
    ),
    requestSchema: schedulePostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: {},
  },
  {
    toolName: "posts.unschedule",
    operationId: "unschedulePost",
    requiredScope: "posts:publish",
    description: opDescription("Cancel a pending or failed scheduled publication.", "posts:publish", writeErrors),
    requestSchema: unschedulePostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: {},
  },
  {
    toolName: "posts.preview.rotate",
    operationId: "rotatePostPreview",
    requiredScope: "posts:update",
    description: opDescription("Rotate a private preview link, immediately revoking the old URL.", "posts:update", writeErrors),
    requestSchema: rotatePostPreviewRequestSchema,
    responseSchema: postDtoSchema,
    annotations: {},
  },
  {
    toolName: "posts.archive",
    operationId: "archivePost",
    requiredScope: "posts:archive",
    description: opDescription(
      "Take a post off the blog (or shelve a draft); returns the archived post. Restore with posts.unarchive. Send posts.get.currentVersionNumber as expectedVersionNumber after approval; a changed tip returns CONFLICT. Live change: needs explicit owner approval first (see server instructions).",
      "posts:archive",
      writeErrors,
    ),
    requestSchema: archivePostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: { destructive: true },
  },
  {
    toolName: "posts.unarchive",
    operationId: "unarchivePost",
    requiredScope: "posts:update",
    description: opDescription("Restore an archived post to draft.", "posts:update", writeErrors),
    requestSchema: unarchivePostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: {},
  },
  {
    toolName: "assets.upload",
    operationId: "uploadAsset",
    requiredScope: "assets:write",
    description: opDescription(
      "Upload an image from base64 data. Decoded image must be 10 MB or smaller. Uploading makes the image public before post publication. Returns asset metadata and a public URL for Markdown.",
      "assets:write",
      `${writeErrors} Upload validation failures surface as VALIDATION_ERROR or billing/quota messages.`,
    ),
    requestSchema: uploadAssetRequestSchema,
    responseSchema: assetDtoSchema,
    annotations: {},
  },
  {
    toolName: "assets.list",
    operationId: "listAssets",
    requiredScope: "assets:write",
    description: opDescription(
      "List image assets for the current site, newest first.",
      "assets:write",
      readErrors,
    ),
    requestSchema: listAssetsRequestSchema,
    responseSchema: z.array(assetDtoSchema),
    annotations: { readOnly: true },
  },
  {
    toolName: "assets.get",
    operationId: "getAsset",
    requiredScope: "assets:write",
    description: opDescription(
      "Get one image asset's metadata + public URL by id.",
      "assets:write",
      readErrors,
    ),
    requestSchema: getAssetRequestSchema,
    responseSchema: assetDtoSchema,
    annotations: { readOnly: true },
  },
  {
    toolName: "assets.update",
    operationId: "updateAsset",
    requiredScope: "assets:write",
    description: opDescription("Update an image asset's alt text.", "assets:write", writeErrors),
    requestSchema: updateAssetRequestSchema,
    responseSchema: assetDtoSchema,
    annotations: { idempotent: true },
  },
  {
    toolName: "assets.delete",
    operationId: "deleteAsset",
    requiredScope: "assets:delete",
    description: opDescription(
      "Delete an image asset (file + metadata). CONFLICT if it is a post cover or site social image. Live change: needs explicit owner approval first (see server instructions).",
      "assets:delete",
      writeErrors,
    ),
    requestSchema: deleteAssetRequestSchema,
    responseSchema: assetDtoSchema,
    annotations: { destructive: true },
  },
  {
    toolName: "activity.list",
    operationId: "listActivity",
    requiredScope: "activity:read",
    description: opDescription(
      "List activity for the current site with limit and offset pagination.",
      "activity:read",
      readErrors,
    ),
    requestSchema: listActivityRequestSchema,
    responseSchema: z.array(activityDtoSchema),
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.versions.list",
    operationId: "listPostVersions",
    requiredScope: "posts:read",
    description: opDescription(
      "List version history for a post, newest first. Each summary includes versionNumber, actorType, actorName, changeSummary, and status.",
      "posts:read",
      readErrors,
    ),
    requestSchema: listPostVersionsRequestSchema,
    responseSchema: z.array(postVersionSummaryDtoSchema),
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.versions.get",
    operationId: "getPostVersion",
    requiredScope: "posts:read",
    description: opDescription(
      "Get a specific version of a post by versionNumber, including full Markdown content.",
      "posts:read",
      readErrors,
    ),
    requestSchema: getPostVersionRequestSchema,
    responseSchema: postVersionDtoSchema,
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.versions.restore",
    operationId: "restorePostVersion",
    requiredScope: "posts:update",
    description: opDescription(
      "Restore a post to a previous version. Provide expectedVersionNumber for the current tip; stale tips return CONFLICT. Content-only restore (never re-publishes). Creates a new version entry and a post.restored activity. Returns the updated post.",
      "posts:update",
      writeErrors,
    ),
    requestSchema: restorePostVersionRequestSchema,
    responseSchema: postDtoSchema,
    annotations: { idempotent: false },
  },
  {
    toolName: "posts.format_guide",
    operationId: "getFormatGuide",
    requiredScope: "posts:read",
    description: opDescription(
      "Returns supported post-formatting syntax + guidance; CALL BEFORE DRAFTING OR PUBLISHING. Site-theme-aware.",
      "posts:read",
      readErrors,
    ),
    requestSchema: getFormatGuideRequestSchema,
    responseSchema: formatGuideDtoSchema,
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.preview",
    operationId: "previewPost",
    requiredScope: "posts:read",
    description: opDescription(
      "Render markdown to HTML with the same renderer as the public blog; returns outline + warnings. Send either postId for the current saved tip or contentMarkdown for unsaved input, never both. previewUrl is a secret bearer link to the current saved tip, not an immutable version. Share only with the owner or explicitly authorized reviewers; never put it in public content. Rotate it if exposed.",
      "posts:read",
      readErrors,
    ),
    requestSchema: previewPostRequestSchema,
    responseSchema: previewPostDtoSchema,
    annotations: { readOnly: true },
  },
] as const satisfies readonly OperationDefinition[];

export type McpToolName = (typeof operations)[number]["toolName"];

export const operationsByToolName = operations.reduce(
  (acc, op) => {
    acc[op.toolName] = op;
    return acc;
  },
  {} as Record<McpToolName, (typeof operations)[number]>,
);

export const mcpToolNames = operations.map((op) => op.toolName) as McpToolName[];
