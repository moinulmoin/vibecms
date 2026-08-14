import { AppError, RateLimitError, can, type Actor } from "@vc/core";
import { env } from "cloudflare:workers";
import { FORM_STATUS } from "@vc/config";
import { mcpInstructions } from "@vc/mcp";
import {
  mcpToolNames as contractToolNames,
  operations,
  operationsByToolName,
  zodToInputJsonSchema,
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
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const INITIALIZE_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const SUPPORTED_PROTOCOL_VERSIONS = [MODERN_PROTOCOL_VERSION, ...INITIALIZE_PROTOCOL_VERSIONS] as const;
const DEFAULT_INITIALIZE_PROTOCOL_VERSION = INITIALIZE_PROTOCOL_VERSIONS[0];
const SERVER_INFO = { name: "vibecms", version: "0.1.0" } as const;
const DISCOVERY_TTL_MS = 300_000;
const recoverableToolErrorCodes = new Set(["VALIDATION_ERROR", "CONFLICT", "NOT_FOUND"]);

function negotiateInitializeProtocolVersion(params: unknown): string {
  const requested = stringParam(asObject(params), "protocolVersion");
  return requested && (INITIALIZE_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : DEFAULT_INITIALIZE_PROTOCOL_VERSION;
}

function requestMeta(params: unknown) {
  return asObject(asObject(params)._meta);
}

function completeResult(value: unknown) {
  const record = asObject(value);
  return {
    ...record,
    resultType: "complete",
    _meta: {
      ...asObject(record._meta),
      "io.modelcontextprotocol/serverInfo": SERVER_INFO,
    },
  };
}

function result(id: JsonRpcRequest["id"], value: unknown, modern = false) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result: modern ? completeResult(value) : value });
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 200,
  headers?: HeadersInit,
  data?: unknown,
) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } },
    { status, headers },
  );
}

function hasInvalidOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

function decodeMirroredHeader(value: string): string | undefined {
  const encodedPrefix = "=?base64?";
  if (value.startsWith(encodedPrefix) && value.endsWith("?=")) {
    try {
      const bytes = Uint8Array.from(atob(value.slice(encodedPrefix.length, -2)), (character) =>
        character.charCodeAt(0),
      );
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      return undefined;
    }
  }
  return /^[\x20-\x7e]+$/.test(value) ? value : undefined;
}

function unsupportedProtocolVersion(id: JsonRpcRequest["id"], requested: string) {
  return rpcError(id, -32022, "Unsupported protocol version", 400, undefined, {
    supported: [...SUPPORTED_PROTOCOL_VERSIONS],
    requested,
  });
}

function validateModernRequest(request: Request, body: JsonRpcRequest): Response | undefined {

  const meta = requestMeta(body.params);
  const protocolHeader = request.headers.get("MCP-Protocol-Version");
  const metaVersion = meta["io.modelcontextprotocol/protocolVersion"];
  if (!protocolHeader || typeof metaVersion !== "string" || protocolHeader !== metaVersion) {
    return rpcError(body.id, -32020, "Header mismatch: MCP-Protocol-Version must match request _meta", 400);
  }
  if (protocolHeader !== MODERN_PROTOCOL_VERSION) {
    return unsupportedProtocolVersion(body.id, protocolHeader);
  }
  if (body.id === undefined || body.id === null) {
    return rpcError(body.id, -32600, "Modern MCP requests require a string or number id", 400);
  }

  const methodHeader = request.headers.get("Mcp-Method");
  if (!methodHeader || methodHeader !== body.method) {
    return rpcError(body.id, -32020, "Header mismatch: Mcp-Method must match the request method", 400);
  }

  if (body.method === "tools/call") {
    const bodyName = asObject(body.params).name;
    const nameHeader = request.headers.get("Mcp-Name");
    const decodedName = nameHeader ? decodeMirroredHeader(nameHeader) : undefined;
    if (typeof bodyName !== "string" || !decodedName || decodedName !== bodyName) {
      return rpcError(body.id, -32020, "Header mismatch: Mcp-Name must match the requested tool", 400);
    }
  }

  const clientCapabilities = meta["io.modelcontextprotocol/clientCapabilities"];
  if (!clientCapabilities || typeof clientCapabilities !== "object" || Array.isArray(clientCapabilities)) {
    return rpcError(body.id, -32602, "Missing or invalid client capabilities in request _meta", 400);
  }
}

function isJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("application/json");
}

function isRpcId(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || typeof value === "number";
}

function hasBearerAuthorization(request: Request) {
  return Boolean(request.headers.get("authorization")?.startsWith("Bearer "));
}

/** Validate a parsed JSON value as a single JSON-RPC 2.0 request (batches are not implemented). */
function validateJsonRpcRequest(value: unknown): { ok: true; body: JsonRpcRequest } | { ok: false; response: Response } {
  // null, primitives, and arrays (batch) are all Invalid Request — not a crash.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: rpcError(null, -32600, "Invalid Request", 400) };
  }
  const record = value as Record<string, unknown>;
  const id = isRpcId(record.id) ? record.id : null;
  if (record.jsonrpc !== "2.0") {
    return { ok: false, response: rpcError(id, -32600, "Invalid Request", 400) };
  }
  if (typeof record.method !== "string" || record.method.length === 0) {
    return { ok: false, response: rpcError(id, -32600, "Invalid Request", 400) };
  }
  if ("id" in record && !isRpcId(record.id)) {
    return { ok: false, response: rpcError(null, -32600, "Invalid Request", 400) };
  }
  return {
    ok: true,
    body: {
      jsonrpc: "2.0",
      method: record.method,
      ...("id" in record ? { id: record.id as string | number | null } : {}),
      ...("params" in record ? { params: record.params } : {}),
    },
  };
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

// MCP requires each tool outputSchema to be a top-level object; wrap array/nullable DTOs under result.
function outputSchemaFor(responseSchema: Parameters<typeof zodToJsonSchema>[0]) {
  const inner = zodToJsonSchema(responseSchema);
  if (inner.type === "object") return { schema: inner, wrap: false };
  return {
    schema: { type: "object", properties: { result: inner }, required: ["result"], additionalProperties: false },
    wrap: true,
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
  const { schema, wrap } = outputSchemaFor(op.responseSchema);
  return structuredToolResult(wrap ? { result: dto } : dto, schema);
}

function listedTools(actor?: Actor) {
  return {
    tools: operations
      .filter((op) => !actor || can(actor, op.requiredScope))
      .map((op) => {
        const annotations: Record<string, boolean> = {};
        const hints = op.annotations as OperationAnnotations;
        if (hints.readOnly) annotations.readOnlyHint = true;
        if (hints.destructive) annotations.destructiveHint = true;
        if (hints.idempotent) annotations.idempotentHint = true;
        return {
          name: op.toolName,
          description: op.description,
          inputSchema: zodToInputJsonSchema(op.requestSchema),
          outputSchema: outputSchemaFor(op.responseSchema).schema,
          annotations,
          _meta: {
            "vibecms.com/requiredScope": op.requiredScope,
          },
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
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
  if (hasInvalidOrigin(request)) return new Response("Forbidden", { status: 403 });
  if (request.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!isJsonContentType(request)) {
    return rpcError(null, -32600, "Content-Type must be application/json", 400);
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }

  const validated = validateJsonRpcRequest(parsed);
  if (!validated.ok) return validated.response;
  const body = validated.body;
  const meta = requestMeta(body.params);
  const protocolHeader = request.headers.get("MCP-Protocol-Version");
  const metaVersion = meta["io.modelcontextprotocol/protocolVersion"];
  const hasModernMetadata =
    "io.modelcontextprotocol/protocolVersion" in meta ||
    "io.modelcontextprotocol/clientCapabilities" in meta;
  const modern =
    hasModernMetadata ||
    [protocolHeader, metaVersion].some(
      (version) =>
        typeof version === "string" &&
        !(INITIALIZE_PROTOCOL_VERSIONS as readonly string[]).includes(version),
    );

  if (modern) {
    const modernError = validateModernRequest(request, body);
    if (modernError) return modernError;
  }

  if (!modern && body.method === "initialize") {
    return result(body.id, {
      protocolVersion: negotiateInitializeProtocolVersion(body.params),
      capabilities: { tools: {} },
      serverInfo: { ...SERVER_INFO, title: "vibecms" },
      instructions: mcpInstructions,
    });
  }
  if (!modern && body.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }
  if (modern && body.method === "server/discover") {
    return result(
      body.id,
      {
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: { tools: {} },
        instructions: mcpInstructions,
        ttlMs: DISCOVERY_TTL_MS,
        cacheScope: "public",
      },
      true,
    );
  }
  if (body.method === "tools/list") {
    // Unauthenticated discovery is allowed; a Bearer header requires auth + read budget.
    if (!hasBearerAuthorization(request)) {
      return result(
        body.id,
        {
          ...listedTools(),
          ...(modern ? { ttlMs: DISCOVERY_TTL_MS, cacheScope: "public" } : {}),
        },
        modern,
      );
    }
    const auth = await authenticateBearerToken(request);
    if (!auth) return rpcError(body.id, -32001, "Unauthorized", 401);
    try {
      await enforceApiBudget({
        workspaceId: auth.workspaceId,
        siteId: auth.siteId,
        tokenId: auth.tokenId,
        kind: "read",
        force: forceQuotaForSmoke(request),
      });
      return result(
        body.id,
        {
          ...listedTools(auth.actor),
          ...(modern ? { ttlMs: DISCOVERY_TTL_MS, cacheScope: "private" } : {}),
        },
        modern,
      );
    } catch (error) {
      if (error instanceof AppError) return appRpcError(body.id, error);
      return rpcError(body.id, -32000, "Tool failed", 500);
    }
  }

  if (body.method !== "tools/call") {
    return rpcError(body.id, -32601, "Method not found", modern ? 404 : 200);
  }
  const auth = await authenticateBearerToken(request);
  if (!auth) return rpcError(body.id, -32001, "Unauthorized", 401);
  const params = asObject(body.params);
  const name = stringParam(params, "name");
  if (!name) return rpcError(body.id, -32602, "Tool name is required", 400);
  if (!(contractToolNames as readonly string[]).includes(name)) {
    return rpcError(body.id, -32602, `Unknown tool: ${name}`, 400);
  }

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
      modern,
    );
  } catch (error) {
    const validationMessage = zodValidationMessage(error);
    if (validationMessage) return result(body.id, toolError(validationMessage), modern);
    if (error instanceof UploadError) {
      return result(body.id, toolError(FORM_STATUS[error.code]?.message ?? "Upload failed."), modern);
    }
    if (error instanceof AppError) {
      if (recoverableToolErrorCodes.has(error.code)) return result(body.id, toolError(error.message), modern);
      return appRpcError(body.id, error);
    }
    return rpcError(body.id, -32000, "Tool failed", 500);
  }
}
