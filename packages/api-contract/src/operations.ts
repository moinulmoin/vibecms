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
  siteDtoSchema,
} from "./dto";
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

function opDescription(body: string, scope: Scope, errors: string) {
  return `${body}${scopeSuffix(scope)} ${errors}`.trim();
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
      "Get the current site for this token.",
      "sites:read",
      readErrors,
    ),
    requestSchema: getSiteRequestSchema,
    responseSchema: siteDtoSchema.nullable(),
    annotations: { readOnly: true },
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
      "Get one post by id, including full Markdown.",
      "posts:read",
      readErrors,
    ),
    requestSchema: getPostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: { readOnly: true },
  },
  {
    toolName: "posts.create",
    operationId: "createPost",
    requiredScope: "posts:create",
    description: opDescription(
      "Create a draft post from a Markdown body. Returns the new post id; make it live with posts.publish.",
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
      "Publish exactly the approved draft version. Pass the latest versionNumber as expectedVersionNumber; a newer edit returns CONFLICT without publishing.",
      "posts:publish",
      writeErrors,
    ),
    requestSchema: publishPostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: {},
  },
  {
    toolName: "posts.archive",
    operationId: "archivePost",
    requiredScope: "posts:archive",
    description: opDescription(
      "Archive a post.",
      "posts:archive",
      writeErrors,
    ),
    requestSchema: archivePostRequestSchema,
    responseSchema: postDtoSchema,
    annotations: { destructive: true },
  },
  {
    toolName: "assets.upload",
    operationId: "uploadAsset",
    requiredScope: "assets:write",
    description: opDescription(
      "Upload an image from base64 data. Decoded image must be 10 MB or smaller. Returns asset metadata and a public URL for Markdown.",
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
    toolName: "assets.delete",
    operationId: "deleteAsset",
    requiredScope: "assets:write",
    description: opDescription(
      "Delete an image asset (file + metadata). CONFLICT if it is a post cover image.",
      "assets:write",
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
      "List recent activity for the current site.",
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
      "Render markdown to HTML with the same renderer as the public blog; returns outline + warnings; call to self-check before publishing.",
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