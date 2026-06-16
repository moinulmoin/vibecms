import {
  activityDtoSchema,
  apiErrorEnvelopeSchema,
  archivePostRequestSchema,
  assetDtoSchema,
  createPostRequestSchema,
  getPostRequestSchema,
  listActivityRequestSchema,
  listPostsRequestSchema,
  operationsByToolName,
  paginationMetaSchema,
  postDtoSchema,
  postSummaryDtoSchema,
  publishPostRequestSchema,
  siteDtoSchema,
  updatePostRequestSchema,
  uploadAssetRequestSchema,
} from "@vc/api-contract";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const bearerSecurity = [{ bearerAuth: [] }];

export const openApiInfo = {
  openapi: "3.1.0" as const,
  info: { title: "VibeCMS API", version: "1.0.0" },
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
const listActivityOpDef = operationsByToolName["activity.list"];

const listPostsResponseSchema = z.object({
  posts: z.array(postSummaryDtoSchema),
  pagination: paginationMetaSchema,
});

const postIdParamsSchema = getPostRequestSchema;
const updatePostBodySchema = updatePostRequestSchema.omit({ postId: true });

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
    params: publishPostRequestSchema,
  },
  responses: {
    200: {
      description: "Published post",
      content: { "application/json": { schema: postDtoSchema } },
    },
    ...routeErrors(400, 401, 402, 403, 404, 429, 500),
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
  listActivityRoute,
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