import {
  activityDtoSchema,
  apiErrorEnvelopeSchema,
  archivePostRequestSchema,
  assetDtoSchema,
  createPostRequestSchema,
  formatGuideDtoSchema,
  getAssetRequestSchema,
  getFormatGuideRequestSchema,
  getPostRequestSchema,
  listActivityRequestSchema,
  listPostsRequestSchema,
  operationsByToolName,
  paginationMetaSchema,
  postDtoSchema,
  postSummaryDtoSchema,
  postVersionDtoSchema,
  postVersionSummaryDtoSchema,
  previewPostDtoSchema,
  previewPostRequestSchema,
  publishPostRequestSchema,
  siteDtoSchema,
  updatePostRequestSchema,
  uploadAssetRequestSchema,
} from "@vc/api-contract";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const bearerSecurity = [{ bearerAuth: [] }];

export const openApiInfo = {
  openapi: "3.1.0" as const,
  info: { title: "vibecms API", version: "1.0.0" },
  security: bearerSecurity,
};

export const bearerAuthSecurityScheme = {
  type: "http" as const,
  scheme: "bearer" as const,
  description: "Workspace API token (vc_…)",
};

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: apiErrorEnvelopeSchema } },
  };
}

export const errorResponses = {
  400: errorResponse("Invalid request"),
  401: errorResponse("Missing or invalid bearer token"),
  402: errorResponse("Billing required"),
  403: errorResponse("Forbidden"),
  404: errorResponse("Not found"),
  409: errorResponse("Conflict"),
  429: errorResponse("Rate limit exceeded"),
  500: errorResponse("Internal server error"),
} as const;

type ErrorStatus = keyof typeof errorResponses;

function routeErrors(...statuses: ErrorStatus[]) {
  return Object.fromEntries(statuses.map((status) => [status, errorResponses[status]])) as Record<
    ErrorStatus,
    (typeof errorResponses)[ErrorStatus]
  >;
}

const getSiteOpDef = operationsByToolName["sites.get"];
const listPostsOpDef = operationsByToolName["posts.list"];
const getPostOpDef = operationsByToolName["posts.get"];
const createPostOpDef = operationsByToolName["posts.create"];
const updatePostOpDef = operationsByToolName["posts.update"];
const publishPostOpDef = operationsByToolName["posts.publish"];
const archivePostOpDef = operationsByToolName["posts.archive"];
const uploadAssetOpDef = operationsByToolName["assets.upload"];
const listAssetsOpDef = operationsByToolName["assets.list"];
const getAssetOpDef = operationsByToolName["assets.get"];
const deleteAssetOpDef = operationsByToolName["assets.delete"];
const listActivityOpDef = operationsByToolName["activity.list"];
const listPostVersionsOpDef = operationsByToolName["posts.versions.list"];
const getPostVersionOpDef = operationsByToolName["posts.versions.get"];
const restorePostVersionOpDef = operationsByToolName["posts.versions.restore"];
const getFormatGuideOpDef = operationsByToolName["posts.format_guide"];
const previewPostOpDef = operationsByToolName["posts.preview"];


const listPostsResponseSchema = z.object({
  posts: z.array(postSummaryDtoSchema),
  pagination: paginationMetaSchema,
});

const postIdParamsSchema = getPostRequestSchema;
const updatePostBodySchema = updatePostRequestSchema.omit({ postId: true });
const publishPostBodySchema = publishPostRequestSchema.omit({ postId: true });

const postVersionParamsSchema = z.object({
  postId: z.string().min(1),
  versionNumber: z.coerce.number().int().min(1),
});
const assetIdParamsSchema = getAssetRequestSchema;

export const getSiteRoute = createRoute({
  method: "get",
  path: "/site",
  operationId: getSiteOpDef.operationId,
  description: getSiteOpDef.description,
  security: bearerSecurity,
  responses: {
    200: {
      description: "Current site",
      content: { "application/json": { schema: siteDtoSchema.nullable() } },
    },
    ...routeErrors(401, 403, 429, 500),
  },
});

export const listPostsRoute = createRoute({
  method: "get",
  path: "/posts",
  operationId: listPostsOpDef.operationId,
  description: listPostsOpDef.description,
  security: bearerSecurity,
  request: {
    query: listPostsRequestSchema,
  },
  responses: {
    200: {
      description: "Bounded post summaries",
      content: { "application/json": { schema: listPostsResponseSchema } },
    },
    ...routeErrors(400, 401, 403, 429, 500),
  },
});

export const getPostRoute = createRoute({
  method: "get",
  path: "/posts/{postId}",
  operationId: getPostOpDef.operationId,
  description: getPostOpDef.description,
  security: bearerSecurity,
  request: {
    params: postIdParamsSchema,
  },
  responses: {
    200: {
      description: "Post with full Markdown",
      content: { "application/json": { schema: postDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 404, 429, 500),
  },
});

export const createPostRoute = createRoute({
  method: "post",
  path: "/posts",
  operationId: createPostOpDef.operationId,
  description: createPostOpDef.description,
  security: bearerSecurity,
  request: {
    body: {
      content: { "application/json": { schema: createPostRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Created post",
      content: { "application/json": { schema: postDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 409, 429, 500),
  },
});

export const updatePostRoute = createRoute({
  method: "patch",
  path: "/posts/{postId}",
  operationId: updatePostOpDef.operationId,
  description: updatePostOpDef.description,
  security: bearerSecurity,
  request: {
    params: postIdParamsSchema,
    body: {
      content: { "application/json": { schema: updatePostBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated post",
      content: { "application/json": { schema: postDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 404, 409, 429, 500),
  },
});

export const publishPostRoute = createRoute({
  method: "post",
  path: "/posts/{postId}/publish",
  operationId: publishPostOpDef.operationId,
  description: publishPostOpDef.description,
  security: bearerSecurity,
  request: {
    params: postIdParamsSchema,
    body: {
      content: { "application/json": { schema: publishPostBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Published post",
      content: { "application/json": { schema: postDtoSchema } },
    },
    ...routeErrors(400, 401, 402, 403, 404, 409, 429, 500),
  },
});

export const archivePostRoute = createRoute({
  method: "post",
  path: "/posts/{postId}/archive",
  operationId: archivePostOpDef.operationId,
  description: archivePostOpDef.description,
  security: bearerSecurity,
  request: {
    params: archivePostRequestSchema,
  },
  responses: {
    200: {
      description: "Archived post",
      content: { "application/json": { schema: postDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 404, 429, 500),
  },
});

export const uploadAssetRoute = createRoute({
  method: "post",
  path: "/assets",
  operationId: uploadAssetOpDef.operationId,
  description: uploadAssetOpDef.description,
  security: bearerSecurity,
  request: {
    body: {
      content: { "application/json": { schema: uploadAssetRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Uploaded asset",
      content: { "application/json": { schema: assetDtoSchema } },
    },
    ...routeErrors(400, 401, 402, 403, 429, 500),
  },
});

export const listAssetsRoute = createRoute({
  method: "get",
  path: "/assets",
  operationId: listAssetsOpDef.operationId,
  description: listAssetsOpDef.description,
  security: bearerSecurity,
  responses: {
    200: {
      description: "Image assets for the current site, newest first",
      content: { "application/json": { schema: z.array(assetDtoSchema) } },
    },
    ...routeErrors(401, 403, 429, 500),
  },
});

export const getAssetRoute = createRoute({
  method: "get",
  path: "/assets/{assetId}",
  operationId: getAssetOpDef.operationId,
  description: getAssetOpDef.description,
  security: bearerSecurity,
  request: {
    params: assetIdParamsSchema,
  },
  responses: {
    200: {
      description: "Asset metadata + public URL",
      content: { "application/json": { schema: assetDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 404, 429, 500),
  },
});

export const deleteAssetRoute = createRoute({
  method: "delete",
  path: "/assets/{assetId}",
  operationId: deleteAssetOpDef.operationId,
  description: deleteAssetOpDef.description,
  security: bearerSecurity,
  request: {
    params: assetIdParamsSchema,
  },
  responses: {
    200: {
      description: "Deleted asset metadata",
      content: { "application/json": { schema: assetDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 404, 409, 429, 500),
  },
});

export const listActivityRoute = createRoute({
  method: "get",
  path: "/activity",
  operationId: listActivityOpDef.operationId,
  description: listActivityOpDef.description,
  security: bearerSecurity,
  request: {
    query: listActivityRequestSchema,
  },
  responses: {
    200: {
      description: "Recent activity",
      content: { "application/json": { schema: z.array(activityDtoSchema) } },
    },
    ...routeErrors(400, 401, 403, 429, 500),
  },
});

export const listPostVersionsRoute = createRoute({
  method: "get",
  path: "/posts/{postId}/versions",
  operationId: listPostVersionsOpDef.operationId,
  description: listPostVersionsOpDef.description,
  security: bearerSecurity,
  request: {
    params: postIdParamsSchema,
  },
  responses: {
    200: {
      description: "Post version history",
      content: { "application/json": { schema: z.array(postVersionSummaryDtoSchema) } },
    },
    ...routeErrors(400, 401, 403, 404, 429, 500),
  },
});

export const getPostVersionRoute = createRoute({
  method: "get",
  path: "/posts/{postId}/versions/{versionNumber}",
  operationId: getPostVersionOpDef.operationId,
  description: getPostVersionOpDef.description,
  security: bearerSecurity,
  request: {
    params: postVersionParamsSchema,
  },
  responses: {
    200: {
      description: "Post version with full Markdown",
      content: { "application/json": { schema: postVersionDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 404, 429, 500),
  },
});

export const restorePostVersionRoute = createRoute({
  method: "post",
  path: "/posts/{postId}/versions/{versionNumber}/restore",
  operationId: restorePostVersionOpDef.operationId,
  description: restorePostVersionOpDef.description,
  security: bearerSecurity,
  request: {
    params: postVersionParamsSchema,
  },
  responses: {
    200: {
      description: "Updated post after restore",
      content: { "application/json": { schema: postDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 404, 429, 500),
  },
});

export const getFormatGuideRoute = createRoute({
  method: "get",
  path: "/posts/format-guide",
  operationId: getFormatGuideOpDef.operationId,
  description: getFormatGuideOpDef.description,
  security: bearerSecurity,
  request: {
    query: getFormatGuideRequestSchema,
  },
  responses: {
    200: {
      description: "Post formatting syntax guide",
      content: { "application/json": { schema: formatGuideDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 429, 500),
  },
});

export const previewPostRoute = createRoute({
  method: "post",
  path: "/posts/preview",
  operationId: previewPostOpDef.operationId,
  description: previewPostOpDef.description,
  security: bearerSecurity,
  request: {
    body: { content: { "application/json": { schema: previewPostRequestSchema } } },
  },
  responses: {
    200: {
      description: "Rendered preview",
      content: { "application/json": { schema: previewPostDtoSchema } },
    },
    ...routeErrors(400, 401, 403, 429, 500),
  },
});

/** All REST operation route definitions (order is stable for spec generation). */
export const apiV1OperationRoutes = [
  getSiteRoute,
  listPostsRoute,
  getPostRoute,
  createPostRoute,
  updatePostRoute,
  publishPostRoute,
  archivePostRoute,
  uploadAssetRoute,
  listAssetsRoute,
  getAssetRoute,
  deleteAssetRoute,
  listActivityRoute,
  listPostVersionsRoute,
  getPostVersionRoute,
  restorePostVersionRoute,
  getFormatGuideRoute,
  previewPostRoute,
] as const;

const noopHandler = async (c: { json: (body: unknown, status: number) => Response }) => c.json({}, 501);

/**
 * Builds the OpenAPI 3.1 document without importing worker env or operation handlers.
 * Safe to run from plain Node (see `pnpm openapi:gen`).
 */
export function buildOpenApiDocument() {
  const app = new OpenAPIHono().basePath("/api/v1");

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", bearerAuthSecurityScheme);

  for (const route of apiV1OperationRoutes) {
    app.openapi(route, noopHandler as never);
  }

  return app.getOpenAPI31Document(openApiInfo);
}