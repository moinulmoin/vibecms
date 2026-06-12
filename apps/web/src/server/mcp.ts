import { AppError, archivePost, can, createPost, getPost, listPosts, publishPost, requireScope, updatePost, type Actor, type Post } from "@vc/core";
import { MEDIA } from "@vc/config";
import { createD1PostRepository } from "@vc/db";
import { mcpTools } from "@vc/mcp";
import { allowedImageMimeTypes } from "@vc/validators";
import { env } from "cloudflare:workers";
import { authenticateBearerToken } from "./api-keys";
import { getBillingStatusForSite } from "./billing";
import { uploadAsset } from "./media";

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

function result(id: JsonRpcRequest["id"], value: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result: value });
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function textResult(value: unknown): { content: ToolContent[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
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
  if (billingStatus !== "trialing" && billingStatus !== "active") {
    throw new AppError("BILLING_REQUIRED", "An active trial or subscription is required for MCP writes", 402);
  }
  return billingStatus;
}

async function callTool(name: string, actor: Actor, siteId: string, rawArguments: unknown) {
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
      return textResult(await uploadAsset({ user: { id: actor.id, name: actor.name, email: "api" }, workspaceId: "api", siteId, actor }, base64File(args), stringParam(args, "altText")));
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
      requiredScope: tool.requiredScope,
      ...(actor ? { available: can(actor, tool.requiredScope) } : {}),
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
    case "VALIDATION_ERROR":
      return rpcError(id, -32602, error.message, 400);
    default:
      return rpcError(id, -32000, "Tool failed", error.status >= 400 && error.status < 600 ? error.status : 500);
  }
}

export async function handleMcpRequest(request: Request) {
  if (request.method === "GET") return Response.json({ ok: true, endpoint: "/mcp" });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  let body: JsonRpcRequest;
  try {
    body = await request.json<JsonRpcRequest>();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (body.method === "initialize") return result(body.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "vibecms", version: "0.1.0" } });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "tools/list") {
    const auth = await authenticateBearerToken(request);
    return result(body.id, listedTools(auth?.actor));
  }
  if (body.method !== "tools/call") return rpcError(body.id, -32601, "Method not found");
  const auth = await authenticateBearerToken(request);
  if (!auth) return rpcError(body.id, -32001, "Unauthorized", 401);
  const params = asObject(body.params);
  const name = stringParam(params, "name");
  if (!name) return rpcError(body.id, -32602, "Tool name is required", 400);
  try {
    return result(body.id, await callTool(name, auth.actor, auth.siteId, params.arguments));
  } catch (error) {
    const validationMessage = zodValidationMessage(error);
    if (validationMessage) return rpcError(body.id, -32602, validationMessage, 400);
    if (error instanceof AppError) return appRpcError(body.id, error);
    return rpcError(body.id, -32000, "Tool failed", 500);
  }
}
