import { AppError, RateLimitError, archivePost, can, createPost, getPost, listPosts, publishPost, requireScope, updatePost, type Actor, type Post } from "@vc/core";
import { FORM_STATUS, MEDIA } from "@vc/config";
import { createD1PostRepository } from "@vc/db";
import { mcpInstructions, mcpToolNames, mcpTools } from "@vc/mcp";
import { allowedImageMimeTypes } from "@vc/validators";
import { env } from "cloudflare:workers";
import { authenticateBearerToken } from "./api-keys";
import { apiRateLimitHeaders, enforceApiBudget, type ApiUsageKind } from "./usage";
import { getBillingStatusForSite } from "./billing";
import { UploadError, uploadAsset } from "./media";

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };
type ToolContent = { type: "text"; text: string };
type SiteRow = { id: string; name: string; slug: string; description: string | null; created_at: number; updated_at: number };
type ActivityRow = { id: string; action: string; entity_type: string; entity_id: string; summary: string; actor_type: string; actor_id: string; actor_name: string; created_at: number };

const tools = mcpTools;

function repository() {
  return createD1PostRepository(env.DB);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringParam(params: Record<string, unknown>, name: string) {
  const value = params[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberParam(params: Record<string, unknown>, name: string) {
  const value = params[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function tagsParam(params: Record<string, unknown>) {
  return Array.isArray(params.tags) ? params.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
}

function decodedBase64Length(dataBase64: string) {
  const normalized = dataBase64.replace(/\\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function isAllowedMimeType(type: string): type is typeof allowedImageMimeTypes[number] {
  return allowedImageMimeTypes.includes(type as typeof allowedImageMimeTypes[number]);
}

function base64File(args: Record<string, unknown>) {
  const filename = stringParam(args, "filename");
  const mimeType = stringParam(args, "mimeType");
  const dataBase64 = stringParam(args, "dataBase64");
  if (!filename || !mimeType || !dataBase64) throw new AppError("VALIDATION_ERROR", "filename, mimeType, and dataBase64 are required", 400);
  if (!isAllowedMimeType(mimeType)) throw new AppError("VALIDATION_ERROR", "Unsupported image MIME type", 400);
  if (decodedBase64Length(dataBase64) > MEDIA.maxImageBytes) throw new AppError("VALIDATION_ERROR", "Asset payload exceeds 10 MB", 400);
  try {
    const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
    return new File([bytes], filename, { type: mimeType });
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid base64 asset payload", 400);
  }
}

const writeTools = new Set(["posts.create", "posts.update", "posts.publish", "posts.archive", "assets.upload"]);

function apiUsageKind(toolName: string): ApiUsageKind {
  return writeTools.has(toolName) ? "write" : "read";
}
function forceQuotaForSmoke(request: Request) {
  return env.APP_ENV !== "production" && request.headers.get("x-vibecms-quota-smoke") === "1";
}

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const LATEST_PROTOCOL_VERSION = "2025-06-18";
const recoverableToolErrorCodes = new Set(["VALIDATION_ERROR", "CONFLICT", "NOT_FOUND"]);

function negotiateProtocolVersion(params: unknown): string {
  const requested = stringParam(asObject(params), "protocolVersion");
  return requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

function result(id: JsonRpcRequest["id"], value: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result: value });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200, headers?: HeadersInit) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status, headers });
}

function textResult(value: unknown): { content: ToolContent[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string): { content: ToolContent[]; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function currentSite(siteId: string) {
  return env.DB.prepare("SELECT id, name, slug, description, created_at, updated_at FROM sites WHERE id = ? LIMIT 1").bind(siteId).first<SiteRow>();
}

async function recentActivity(siteId: string, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT id, action, entity_type, entity_id, summary, actor_type, actor_id, actor_name, created_at
     FROM activity_events WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(siteId, Math.min(Math.max(limit, 1), 50)).all<ActivityRow>();
  return rows.results;
}

async function requireBillableSite(siteId: string) {
  const billingStatus = await getBillingStatusForSite(siteId);
  if (billingStatus !== "active") {
    throw new AppError("BILLING_REQUIRED", "An active subscription is required for MCP writes", 402);
  }
  return billingStatus;
}

async function callTool(name: string, actor: Actor, siteId: string, workspaceId: string, rawArguments: unknown) {
  const args = asObject(rawArguments);
  const repo = repository();
  switch (name) {
    case "sites.get":
      requireScope(actor, "sites:read");
      return textResult(await currentSite(siteId));
    case "posts.list":
      return textResult(await listPosts(repo, actor, { siteId, status: stringParam(args, "status") as Post["status"] | undefined, search: stringParam(args, "search"), limit: numberParam(args, "limit"), offset: numberParam(args, "offset") }));
    case "posts.search":
      return textResult(await listPosts(repo, actor, { siteId, search: stringParam(args, "search") ?? "", limit: numberParam(args, "limit"), offset: numberParam(args, "offset") }));
    case "posts.get": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new AppError("VALIDATION_ERROR", "postId is required", 400);
      return textResult(await getPost(repo, actor, siteId, postId));
    }
    case "posts.create":
      await requireBillableSite(siteId);
      return textResult(await createPost(repo, actor, { siteId, title: stringParam(args, "title"), slug: stringParam(args, "slug"), excerpt: stringParam(args, "excerpt"), contentMarkdown: stringParam(args, "contentMarkdown"), tags: tagsParam(args) }));
    case "posts.update": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new AppError("VALIDATION_ERROR", "postId is required", 400);
      await requireBillableSite(siteId);
      return textResult(await updatePost(repo, actor, { siteId, postId, title: stringParam(args, "title"), slug: stringParam(args, "slug"), excerpt: stringParam(args, "excerpt"), contentMarkdown: stringParam(args, "contentMarkdown"), tags: tagsParam(args) }));
    }
    case "posts.publish": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new AppError("VALIDATION_ERROR", "postId is required", 400);
      return textResult(await publishPost(repo, actor, { siteId, postId, billingStatus: await requireBillableSite(siteId) }));
    }
    case "posts.archive": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new AppError("VALIDATION_ERROR", "postId is required", 400);
      await requireBillableSite(siteId);
      return textResult(await archivePost(repo, actor, { siteId, postId }));
    }
    case "assets.upload":
      await requireBillableSite(siteId);
      return textResult(await uploadAsset({ user: { id: actor.id, name: actor.name, email: "api" }, workspaceId, siteId, actor }, base64File(args), stringParam(args, "altText")));
    case "activity.list":
      requireScope(actor, "activity:read");
      return textResult(await recentActivity(siteId, numberParam(args, "limit") ?? 20));
    default:
      throw new AppError("VALIDATION_ERROR", "Unknown tool", 400);
  }
}


function listedTools(actor?: Actor) {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      _meta: {
        "vibecms.com/requiredScope": tool.requiredScope,
        ...(actor ? { "vibecms.com/available": can(actor, tool.requiredScope) } : {}),
      },
    })),
  };
}

function zodValidationMessage(error: unknown) {
  if (!(error instanceof Error) || error.name !== "ZodError") return null;
  const issues = (error as Error & { issues?: Array<{ path?: Array<string | number>; message?: string }> }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return "Invalid params";
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path?.join(".") || "input"}: ${issue.message || "Invalid value"}`)
    .join("; ");
}

function appRpcError(id: JsonRpcRequest["id"], error: AppError) {
  switch (error.code) {
    case "UNAUTHORIZED":
      return rpcError(id, -32001, "Unauthorized", 401);
    case "FORBIDDEN":
      return rpcError(id, -32003, error.message, 403);
    case "BILLING_REQUIRED":
      return rpcError(id, -32004, error.message, 402);
    case "NOT_FOUND":
      return rpcError(id, -32005, error.message, 404);
    case "CONFLICT":
      return rpcError(id, -32009, error.message, 409);
    case "RATE_LIMIT":
      return rpcError(id, -32010, "Rate limit exceeded", 429, apiRateLimitHeaders(error));
    case "VALIDATION_ERROR":
      return rpcError(id, -32602, error.message, 400);
    default:
      return rpcError(id, -32000, "Tool failed", error.status >= 400 && error.status < 600 ? error.status : 500);
  }
}

export async function handleMcpRequest(request: Request) {
  if (request.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  let body: JsonRpcRequest;
  try {
    body = await request.json<JsonRpcRequest>();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  const protocolHeader = request.headers.get("MCP-Protocol-Version");
  if (protocolHeader && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader)) return rpcError(body.id, -32600, `Unsupported MCP-Protocol-Version: ${protocolHeader}`, 400);
  if (body.method === "initialize") return result(body.id, { protocolVersion: negotiateProtocolVersion(body.params), capabilities: { tools: {} }, serverInfo: { name: "vibecms", title: "VibeCMS", version: "0.1.0" }, instructions: mcpInstructions });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "tools/list") {
    const auth = await authenticateBearerToken(request);
    if (!auth) return result(body.id, listedTools());
    try {
      await enforceApiBudget({ workspaceId: auth.workspaceId, siteId: auth.siteId, tokenId: auth.tokenId, kind: "read", force: forceQuotaForSmoke(request) });
      return result(body.id, listedTools(auth.actor));
    } catch (error) {
      if (error instanceof RateLimitError) return appRpcError(body.id, error);
      return rpcError(body.id, -32000, "Tool failed", 500);
    }
  }
  if (body.method !== "tools/call") return rpcError(body.id, -32601, "Method not found");
  const auth = await authenticateBearerToken(request);
  if (!auth) return rpcError(body.id, -32001, "Unauthorized", 401);
  const params = asObject(body.params);
  const name = stringParam(params, "name");
  if (!name) return rpcError(body.id, -32602, "Tool name is required", 400);
  if (!(mcpToolNames as readonly string[]).includes(name)) return rpcError(body.id, -32602, `Unknown tool: ${name}`, 400);
  try {
    await enforceApiBudget({ workspaceId: auth.workspaceId, siteId: auth.siteId, tokenId: auth.tokenId, kind: apiUsageKind(name), force: forceQuotaForSmoke(request) });
    return result(body.id, await callTool(name, auth.actor, auth.siteId, auth.workspaceId, params.arguments));
  } catch (error) {
    const validationMessage = zodValidationMessage(error);
    if (validationMessage) return result(body.id, toolError(validationMessage));
    if (error instanceof UploadError) return result(body.id, toolError(FORM_STATUS[error.code]?.message ?? "Upload failed."));
    if (error instanceof AppError) {
      if (recoverableToolErrorCodes.has(error.code)) return result(body.id, toolError(error.message));
      return appRpcError(body.id, error);
    }
    return rpcError(body.id, -32000, "Tool failed", 500);
  }
}
