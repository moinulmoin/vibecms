import { AppError, archivePost, can, createPost, getPost, listPosts, publishPost, requireScope, updatePost, type Actor, type Post } from "@vc/core";
import { createD1PostRepository } from "@vc/db";
import { env } from "cloudflare:workers";
import { authenticateBearerToken } from "./api-keys";
import { getBillingStatusForSite } from "./billing";
import { uploadAsset } from "./media";

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };
type ToolContent = { type: "text"; text: string };
type SiteRow = { id: string; name: string; slug: string; description: string | null; created_at: number; updated_at: number };
type ActivityRow = { id: string; action: string; entity_type: string; entity_id: string; summary: string; actor_type: string; actor_id: string; actor_name: string; created_at: number };

const tools = [
  { name: "sites.get", description: "Get the current site for this token", inputSchema: { type: "object", properties: {} } },
  { name: "posts.list", description: "List posts for the current site", inputSchema: { type: "object", properties: { status: { type: "string" }, search: { type: "string" } } } },
  { name: "posts.search", description: "Search posts by title, slug, or excerpt", inputSchema: { type: "object", properties: { search: { type: "string" } }, required: ["search"] } },
  { name: "posts.get", description: "Get one post by id", inputSchema: { type: "object", properties: { postId: { type: "string" } }, required: ["postId"] } },
  { name: "posts.create", description: "Create a draft post", inputSchema: { type: "object", properties: { title: { type: "string" }, slug: { type: "string" }, excerpt: { type: "string" }, contentMarkdown: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "slug", "contentMarkdown"] } },
  { name: "posts.update", description: "Update a post", inputSchema: { type: "object", properties: { postId: { type: "string" }, title: { type: "string" }, slug: { type: "string" }, excerpt: { type: "string" }, contentMarkdown: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["postId"] } },
  { name: "posts.publish", description: "Publish a post", inputSchema: { type: "object", properties: { postId: { type: "string" } }, required: ["postId"] } },
  { name: "posts.archive", description: "Archive a post", inputSchema: { type: "object", properties: { postId: { type: "string" } }, required: ["postId"] } },
  { name: "assets.upload", description: "Upload an image from base64 data", inputSchema: { type: "object", properties: { filename: { type: "string" }, mimeType: { type: "string" }, dataBase64: { type: "string" }, altText: { type: "string" } }, required: ["filename", "mimeType", "dataBase64"] } },
  { name: "activity.list", description: "List recent activity", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
];

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

function tagsParam(params: Record<string, unknown>) {
  return Array.isArray(params.tags) ? params.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
}

function base64File(args: Record<string, unknown>) {
  const filename = stringParam(args, "filename");
  const mimeType = stringParam(args, "mimeType");
  const dataBase64 = stringParam(args, "dataBase64");
  if (!filename || !mimeType || !dataBase64) throw new Error("filename, mimeType, and dataBase64 are required");
  const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
  return new File([bytes], filename, { type: mimeType });
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
      return textResult(await listPosts(repo, actor, { siteId, status: stringParam(args, "status") as Post["status"] | undefined, search: stringParam(args, "search") }));
    case "posts.search":
      return textResult(await listPosts(repo, actor, { siteId, search: stringParam(args, "search") ?? "" }));
    case "posts.get": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new Error("postId is required");
      return textResult(await getPost(repo, actor, siteId, postId));
    }
    case "posts.create":
      await requireBillableSite(siteId);
      return textResult(await createPost(repo, actor, { siteId, title: stringParam(args, "title"), slug: stringParam(args, "slug"), excerpt: stringParam(args, "excerpt"), contentMarkdown: stringParam(args, "contentMarkdown"), tags: tagsParam(args) }));
    case "posts.update": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new Error("postId is required");
      await requireBillableSite(siteId);
      return textResult(await updatePost(repo, actor, { siteId, postId, title: stringParam(args, "title"), slug: stringParam(args, "slug"), excerpt: stringParam(args, "excerpt"), contentMarkdown: stringParam(args, "contentMarkdown"), tags: tagsParam(args) }));
    }
    case "posts.publish": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new Error("postId is required");
      return textResult(await publishPost(repo, actor, { siteId, postId, billingStatus: await requireBillableSite(siteId) }));
    }
    case "posts.archive": {
      const postId = stringParam(args, "postId");
      if (!postId) throw new Error("postId is required");
      await requireBillableSite(siteId);
      return textResult(await archivePost(repo, actor, { siteId, postId }));
    }
    case "assets.upload":
      await requireBillableSite(siteId);
      return textResult(await uploadAsset({ user: { id: actor.id, name: actor.name, email: "api" }, workspaceId: "api", siteId, actor }, base64File(args), stringParam(args, "altText")));
    case "activity.list":
      requireScope(actor, "activity:read");
      return textResult(await recentActivity(siteId, typeof args.limit === "number" ? args.limit : 20));
    default:
      throw new Error(`Unknown tool: ${name}`);
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
  if (body.method === "tools/list") return result(body.id, { tools });
  if (body.method !== "tools/call") return rpcError(body.id, -32601, "Method not found");
  const auth = await authenticateBearerToken(request);
  if (!auth) return rpcError(body.id, -32001, "Unauthorized", 401);
  const params = asObject(body.params);
  const name = stringParam(params, "name");
  if (!name) return rpcError(body.id, -32602, "Tool name is required");
  try {
    return result(body.id, await callTool(name, auth.actor, auth.siteId, params.arguments));
  } catch (error) {
    if (error instanceof AppError) return rpcError(body.id, error.code === "BILLING_REQUIRED" ? -32004 : -32000, error.message, error.status);
    const message = error instanceof Error ? error.message : "Tool failed";
    if (message.startsWith("Missing required scope") || !can(auth.actor, "posts:read") && name.startsWith("posts.")) return rpcError(body.id, -32003, message, 403);
    return rpcError(body.id, -32000, message);
  }
}
