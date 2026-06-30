import { AppError, RateLimitError, type Actor } from "@vc/core";
import { env } from "cloudflare:workers";
import { FORM_STATUS } from "@vc/config";
import { mcpInstructions, mcpTools } from "@vc/mcp";
import {
  mcpToolNames as contractToolNames,
  operations,
  operationsByToolName,
  zodToJsonSchema,
  type McpToolName,
  type OperationAnnotations,
} from "@vc/api-contract";
import { authenticateBearerToken } from "./api-keys";
import { apiRateLimitHeaders, enforceApiBudget, type ApiUsageKind } from "./usage";
import { UploadError } from "./media";
import { dispatchOperation } from "./mcp-dispatch";
import type { OperationContext } from "./operations";

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };
type ToolContent = { type: "text"; text: string };

const mcpToolsByName = new Map(mcpTools.map((tool) => [tool.name, tool]));

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringParam(params: Record<string, unknown>, name: string) {
  const value = params[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const writeTools = new Set(["posts.create", "posts.update", "posts.publish", "posts.archive", "posts.versions.restore", "assets.upload", "assets.delete"]);

function apiUsageKind(toolName: string): ApiUsageKind {
  return writeTools.has(toolName) ? "write" : "read";
}

function forceQuotaForSmoke(request: Request) {
  return String(env.APP_ENV) !== "production" && request.headers.get("x-vibecms-quota-smoke") === "1";
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

function structuredToolResult(dto: unknown, outputSchema: Record<string, unknown>) {
  return {
    // Compact JSON: agents read this text into their context, so the
    // pretty-print indentation was pure token overhead. structuredContent
    // carries the machine-readable object for hosts that prefer it.
    content: [{ type: "text" as const, text: JSON.stringify(dto) }],
    structuredContent: dto,
    outputSchema,
  };
}

// Tell the agent how long to wait. MCP hosts often surface the error message
// but not the HTTP headers, so put the reset time in the text too.
function rateLimitMessage(error: unknown): string {
  const status =
    error instanceof RateLimitError
      ? (error as RateLimitError & { usageStatus?: { resetsAt: number; metric: string; period: string } }).usageStatus
      : undefined
  if (!status) return "Rate limit exceeded. Wait for the limit to reset, then retry."
  const seconds = Math.max(1, status.resetsAt - Math.floor(Date.now() / 1000))
  return `Rate limit exceeded on ${status.metric} (${status.period}). Retry after ${seconds}s.`
}

function toolError(message: string): { content: ToolContent[]; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function callTool(name: McpToolName, actor: Actor, siteId: string, workspaceId: string, tokenId: string, rawArguments: unknown) {
  const op = operationsByToolName[name];
  const dto = await dispatchOperation(name, { actor, siteId, workspaceId, tokenId } satisfies OperationContext, rawArguments);
  return structuredToolResult(dto, zodToJsonSchema(op.responseSchema));
}

function listedTools() {
  return {
    tools: operations.map((op) => {
      const catalog = mcpToolsByName.get(op.toolName);
      const annotations: Record<string, boolean> = {};
      const hints = op.annotations as OperationAnnotations;
      if (hints.readOnly) annotations.readOnlyHint = true;
      if (hints.destructive) annotations.destructiveHint = true;
      if (hints.idempotent) annotations.idempotentHint = true;
      return {
        name: op.toolName,
        description: catalog?.description ?? op.description,
        inputSchema: catalog?.inputSchema ?? {},
        outputSchema: zodToJsonSchema(op.responseSchema),
        annotations,
        _meta: {
          "vibecms.com/requiredScope": op.requiredScope,
        },
      };
    }),
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
      return rpcError(id, -32010, rateLimitMessage(error), 429, apiRateLimitHeaders(error));
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
  if (protocolHeader && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader)) {
    return rpcError(body.id, -32600, `Unsupported MCP-Protocol-Version: ${protocolHeader}`, 400);
  }
  if (body.method === "initialize") {
    return result(body.id, {
      protocolVersion: negotiateProtocolVersion(body.params),
      capabilities: { tools: {} },
      serverInfo: { name: "vibecms", title: "vibecms", version: "0.1.0" },
      instructions: mcpInstructions,
    });
  }
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "tools/list") {
    try {
      await authenticateBearerToken(request);
    } catch (error) {
      console.error("mcp.tools_list_auth_failed", {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return result(body.id, listedTools());
  }
  if (body.method !== "tools/call") return rpcError(body.id, -32601, "Method not found");
  const auth = await authenticateBearerToken(request);
  if (!auth) return rpcError(body.id, -32001, "Unauthorized", 401);
  const params = asObject(body.params);
  const name = stringParam(params, "name");
  if (!name) return rpcError(body.id, -32602, "Tool name is required", 400);
  if (!(contractToolNames as readonly string[]).includes(name)) return rpcError(body.id, -32602, `Unknown tool: ${name}`, 400);
  try {
    await enforceApiBudget({
      workspaceId: auth.workspaceId,
      siteId: auth.siteId,
      tokenId: auth.tokenId,
      kind: apiUsageKind(name),
      force: forceQuotaForSmoke(request),
    });
    return result(
      body.id,
      await callTool(name as McpToolName, auth.actor, auth.siteId, auth.workspaceId, auth.tokenId, params.arguments),
    );
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