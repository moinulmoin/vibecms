import {
  apiErrorEnvelopeSchema,
  listPostsRequestSchema,
  operationsByToolName,
  paginationMetaSchema,
  postSummaryDtoSchema,
  siteDtoSchema,
} from "@vc/api-contract";
import { AppError, RateLimitError } from "@vc/core";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { env } from "cloudflare:workers";
import { authenticateBearerToken } from "~/server/api-keys";
import { getSiteOp, listPostsOp, type OperationContext } from "~/server/operations";
import { apiRateLimitHeaders, enforceApiBudget, type ApiUsageKind } from "~/server/usage";

type ApiEnv = {
  Variables: {
    ctx: OperationContext;
  };
};

const bearerSecurity = [{ bearerAuth: [] }];

const getSiteOpDef = operationsByToolName["sites.get"];
const listPostsOpDef = operationsByToolName["posts.list"];

const listPostsResponseSchema = z.object({
  posts: z.array(postSummaryDtoSchema),
  pagination: paginationMetaSchema,
});

const getSiteRoute = createRoute({
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
    401: {
      description: "Missing or invalid bearer token",
      content: { "application/json": { schema: apiErrorEnvelopeSchema } },
    },
  },
});

const listPostsRoute = createRoute({
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
    401: {
      description: "Missing or invalid bearer token",
      content: { "application/json": { schema: apiErrorEnvelopeSchema } },
    },
  },
});

function forceQuotaForSmoke(request: Request) {
  return String(env.APP_ENV) !== "production" && request.headers.get("x-vibecms-quota-smoke") === "1";
}

function usageKind(method: string): ApiUsageKind {
  return method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "write";
}

function zodValidationMessage(error: unknown) {
  if (!(error instanceof Error) || error.name !== "ZodError") return null;
  const issues = (error as Error & { issues?: Array<{ path?: Array<string | number>; message?: string }> }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return "Invalid request";
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path?.join(".") || "input"}: ${issue.message || "Invalid value"}`)
    .join("; ");
}

function errorEnvelope(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

function statusForAppError(error: AppError) {
  switch (error.code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "BILLING_REQUIRED":
      return 402;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "RATE_LIMIT":
      return 429;
    case "VALIDATION_ERROR":
      return 400;
    default:
      return error.status >= 400 && error.status < 600 ? error.status : 500;
  }
}

export const apiV1App = new OpenAPIHono<ApiEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const message = zodValidationMessage(result.error) ?? "Invalid request";
      return c.json(errorEnvelope("VALIDATION_ERROR", message), 400);
    }
  },
}).basePath("/api/v1");

apiV1App.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "Workspace API token (vc_…)",
});

apiV1App.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "VibeCMS API", version: "1.0.0" },
  security: bearerSecurity,
});

apiV1App.use("*", async (c, next) => {
  if (c.req.path === "/api/v1/openapi.json" || c.req.path.endsWith("/openapi.json")) {
    return next();
  }

  const auth = await authenticateBearerToken(c.req.raw);
  if (!auth) {
    return c.json(errorEnvelope("UNAUTHORIZED", "Authentication required"), 401);
  }

  c.set("ctx", {
    actor: auth.actor,
    siteId: auth.siteId,
    workspaceId: auth.workspaceId,
    tokenId: auth.tokenId,
  });

  await enforceApiBudget({
    workspaceId: auth.workspaceId,
    siteId: auth.siteId,
    tokenId: auth.tokenId,
    kind: usageKind(c.req.method),
    force: forceQuotaForSmoke(c.req.raw),
  });

  return next();
});

apiV1App.openapi(getSiteRoute, async (c) => {
  const site = await getSiteOp(c.get("ctx"));
  return c.json(site, 200);
});

apiV1App.openapi(listPostsRoute, async (c) => {
  const query = c.req.valid("query");
  const posts = await listPostsOp(c.get("ctx"), query);
  return c.json(
    {
      posts,
      pagination: { limit: query.limit, offset: query.offset, count: posts.length },
    },
    200,
  );
});

apiV1App.onError((err, c) => {
  if (err instanceof RateLimitError) {
    return c.json(errorEnvelope("RATE_LIMIT", err.message), 429, apiRateLimitHeaders(err) as Record<string, string>);
  }
  if (err instanceof AppError) {
    const status = statusForAppError(err);
    const code = [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "BILLING_REQUIRED",
      "NOT_FOUND",
      "CONFLICT",
      "RATE_LIMIT",
      "VALIDATION_ERROR",
    ].includes(err.code)
      ? err.code
      : "INTERNAL_ERROR";
    return c.json(errorEnvelope(code, err.message), status as 401);
  }
  const zodMessage = zodValidationMessage(err);
  if (zodMessage) {
    return c.json(errorEnvelope("VALIDATION_ERROR", zodMessage), 400);
  }
  return c.json(errorEnvelope("INTERNAL_ERROR", "Request failed"), 500);
});