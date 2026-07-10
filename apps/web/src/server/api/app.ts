import { AppError, RateLimitError } from "@vc/core";
import { apiReference } from "@scalar/hono-api-reference";
import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "cloudflare:workers";
import { authenticateBearerToken } from "~/server/api-keys";
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
  type OperationContext,
} from "~/server/operations";
import { apiRateLimitHeaders, enforceApiBudget, type ApiUsageKind } from "~/server/usage";
import {
  archivePostRoute,
  bearerAuthSecurityScheme,
  createPostRoute,
  deleteAssetRoute,
  getAssetRoute,
  getFormatGuideRoute,
  getPostRoute,
  getPostVersionRoute,
  getSiteRoute,
  listActivityRoute,
  listAssetsRoute,
  listPostsRoute,
  listPostVersionsRoute,
  openApiInfo,
  previewPostRoute,
  publishPostRoute,
  restorePostVersionRoute,
  updatePostRoute,
  uploadAssetRoute,
} from "~/server/api/routes";

type ApiEnv = {
  Variables: {
    ctx: OperationContext;
  };
};

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

function isPublicApiDocPath(path: string) {
  return (
    path === "/api/v1/openapi.json" ||
    path.endsWith("/openapi.json") ||
    path === "/api/v1/docs" ||
    path.endsWith("/docs")
  );
}

export const apiV1App = new OpenAPIHono<ApiEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const message = zodValidationMessage(result.error) ?? "Invalid request";
      return c.json(errorEnvelope("VALIDATION_ERROR", message), 400);
    }
  },
}).basePath("/api/v1");

apiV1App.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", bearerAuthSecurityScheme);

apiV1App.doc31("/openapi.json", openApiInfo);

apiV1App.get(
  "/docs",
  apiReference({
    url: "/api/v1/openapi.json",
  }),
);

apiV1App.use("*", async (c, next) => {
  if (isPublicApiDocPath(c.req.path)) {
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

// Static route MUST precede the parametrized GET /posts/{postId} or it is shadowed.
apiV1App.openapi(getFormatGuideRoute, async (c) => {
  const query = c.req.valid("query");
  const guide = await getFormatGuideOp(c.get("ctx"), query);
  return c.json(guide, 200);
});

apiV1App.openapi(getPostRoute, async (c) => {
  const { postId } = c.req.valid("param");
  const post = await getPostOp(c.get("ctx"), { postId });
  return c.json(post, 200);
});

apiV1App.openapi(createPostRoute, async (c) => {
  const body = c.req.valid("json");
  const post = await createPostOp(c.get("ctx"), body);
  return c.json(post, 201);
});

apiV1App.openapi(updatePostRoute, async (c) => {
  const { postId } = c.req.valid("param");
  const body = c.req.valid("json");
  const post = await updatePostOp(c.get("ctx"), { postId, ...body });
  return c.json(post, 200);
});

apiV1App.openapi(publishPostRoute, async (c) => {
  const { postId } = c.req.valid("param");
  const { expectedVersionNumber } = c.req.valid("json");
  const post = await publishPostOp(c.get("ctx"), { postId, expectedVersionNumber });
  return c.json(post, 200);
});

apiV1App.openapi(archivePostRoute, async (c) => {
  const { postId } = c.req.valid("param");
  const post = await archivePostOp(c.get("ctx"), { postId });
  return c.json(post, 200);
});

apiV1App.openapi(uploadAssetRoute, async (c) => {
  const body = c.req.valid("json");
  const asset = await uploadAssetOp(c.get("ctx"), body);
  return c.json(asset, 201);
});

apiV1App.openapi(listAssetsRoute, async (c) => {
  const assets = await listAssetsOp(c.get("ctx"));
  return c.json(assets, 200);
});

// Static GET /assets must precede the parametrized routes to avoid shadowing.
apiV1App.openapi(getAssetRoute, async (c) => {
  const { assetId } = c.req.valid("param");
  const asset = await getAssetOp(c.get("ctx"), { assetId });
  return c.json(asset, 200);
});

apiV1App.openapi(deleteAssetRoute, async (c) => {
  const { assetId } = c.req.valid("param");
  const asset = await deleteAssetOp(c.get("ctx"), { assetId });
  return c.json(asset, 200);
});

apiV1App.openapi(listActivityRoute, async (c) => {
  const query = c.req.valid("query");
  const activity = await listActivityOp(c.get("ctx"), query);
  return c.json(activity, 200);
});

apiV1App.openapi(listPostVersionsRoute, async (c) => {
  const { postId } = c.req.valid("param");
  const versions = await listPostVersionsOp(c.get("ctx"), { postId });
  return c.json(versions, 200);
});

apiV1App.openapi(getPostVersionRoute, async (c) => {
  const { postId, versionNumber } = c.req.valid("param");
  const version = await getPostVersionOp(c.get("ctx"), { postId, versionNumber });
  return c.json(version, 200);
});

apiV1App.openapi(restorePostVersionRoute, async (c) => {
  const { postId, versionNumber } = c.req.valid("param");
  const post = await restorePostVersionOp(c.get("ctx"), { postId, versionNumber });
  return c.json(post, 200);
});

apiV1App.openapi(previewPostRoute, async (c) => {
  const body = c.req.valid("json");
  const result = await previewPostOp(c.get("ctx"), body);
  return c.json(result, 200);
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