import { AGENT_TOKEN_PRESETS, AppError, RateLimitError, can, type Actor, type Scope } from "@vc/core";
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
import { authenticateBearerToken, hashApiToken } from "./api-keys";
import { createDataAccess } from "@vc/db";
import { agentErrorDetails, invalidApiKeyMessage, signInRequiredMessage } from "./agent-errors";
import { apiRateLimitHeaders, enforceApiBudget, type ApiUsageKind } from "./usage";
import { UploadError } from "./media";
import { dispatchOperation } from "./mcp-dispatch";
import type { OperationContext } from "./operations";
import { logUnhandledException } from "./request-logging";

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringParam(params: Record<string, unknown>, name: string) {
  const value = params[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Single source of truth: the operation registry. Anything not marked readOnly consumes the write budget. */
export function apiUsageKind(toolName: McpToolName): ApiUsageKind {
  return (operationsByToolName[toolName].annotations as OperationAnnotations).readOnly ? "read" : "write";
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

function bearerChallenge(invalid: boolean): HeadersInit {
  const issuer = env.APP_URL.replace(/\/+$/, "");
  return {
    "WWW-Authenticate": `Bearer ${invalid ? 'error="invalid_token", ' : ""}resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", scope="${AGENT_TOKEN_PRESETS.manage.join(" ")}"`,
  };
}

async function authenticateMcp(request: Request): Promise<{ actor: Actor; siteId: string; workspaceId: string; tokenId: string } | null> {
  const token = request.headers.get("authorization")?.slice("Bearer ".length).trim() ?? "";
  if (!token.startsWith("vc_oat_")) return authenticateBearerToken(request);
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = await hashApiToken(token);
  const row = await env.DB.prepare(`SELECT k.id, k.site_id, s.workspace_id, k.name, k.actor_name, k.scopes_json
    FROM oauth_tokens t
    JOIN api_keys k ON k.id = t.api_key_id
    JOIN sites s ON s.id = k.site_id
    JOIN user u ON u.id = k.created_by_user_id
    JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = k.created_by_user_id AND m.role = 'owner'
    WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_at IS NULL
      AND t.expires_at > ? AND t.resource = ? AND k.revoked_at IS NULL
      AND k.oauth_client_id = t.client_id
    LIMIT 1`).bind(hash, timestamp, `${env.APP_URL.replace(/\/+$/, "")}/mcp`).first<{
      id: string; site_id: string; workspace_id: string; name: string; actor_name: string; scopes_json: string
    }>();
  if (!row) return null;
  await createDataAccess(env.DB).apiKeys.markUsed(row.id, timestamp);
  const scopes = JSON.parse(row.scopes_json) as Scope[];
  return {
    siteId: row.site_id, workspaceId: row.workspace_id, tokenId: row.id,
    actor: { type: "api_key", id: row.id, name: scopes.includes("site:write") ? row.name : row.actor_name, scopes },
  };
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

function structuredToolResult(dto: unknown) {
  return {
    // Compact JSON: agents read this text into their context, so the
    // pretty-print indentation was pure token overhead. structuredContent
    // carries the machine-readable object for hosts that prefer it.
    content: [{ type: "text" as const, text: JSON.stringify(dto) }],
    structuredContent: dto,
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

function rateLimitRetryAfterSeconds(error: RateLimitError): number | undefined {
  const usageStatus = "usageStatus" in error ? error.usageStatus : undefined;
  const resetsAt =
    usageStatus && typeof usageStatus === "object" && "resetsAt" in usageStatus
      ? usageStatus.resetsAt
      : undefined;
  if (typeof resetsAt === "number" && Number.isFinite(resetsAt)) {
    return Math.max(1, resetsAt - Math.floor(Date.now() / 1000));
  }
  const retryAfter = "retryAfterSeconds" in error ? error.retryAfterSeconds : undefined;
  return typeof retryAfter === "number" && Number.isFinite(retryAfter)
    ? Math.max(1, Math.ceil(retryAfter))
    : undefined;
}

function toolError(code: string, message: string, details?: unknown, retryAfterSeconds?: number) {
  const presented = agentErrorDetails(code, message, details);
  const error = { code, message: presented.message,
    ...(presented.details === undefined ? {} : { details: presented.details }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
  return { content: [{ type: "text" as const, text: JSON.stringify(error) }], structuredContent: error, isError: true as const };
}

async function callTool(name: McpToolName, actor: Actor, siteId: string, workspaceId: string, tokenId: string, rawArguments: unknown) {
  const op = operationsByToolName[name];
  const dto = await dispatchOperation(name, { actor, siteId, workspaceId, tokenId } satisfies OperationContext, rawArguments);
  const { wrap } = outputSchemaFor(op.responseSchema);
  return structuredToolResult(wrap ? { result: dto } : dto);
}

function listedTools(actor: Actor) {
  return {
    tools: operations
      .filter((op) => op.requiredScope === null || can(actor, op.requiredScope))
      .map((op) => {
        const annotations: Record<string, boolean> = {};
        const hints = op.annotations as OperationAnnotations;
        if (hints.readOnly) annotations.readOnlyHint = true;
        if (hints.destructive) annotations.destructiveHint = true;
        if (hints.idempotent) annotations.idempotentHint = true;
        return {
          name: op.toolName,
          title: op.title,
          description: op.description,
          inputSchema: zodToInputJsonSchema(op.requestSchema),
          // No outputSchema: it was two thirds of tools/list (~48k chars) and
          // every agent paid for it up front. Results still carry
          // structuredContent plus JSON text; typed clients use OpenAPI.
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
      return rpcError(id, -32001, invalidApiKeyMessage(), 401, bearerChallenge(true));
    case "FORBIDDEN":
      return rpcError(id, -32003, error.message, 403);
    case "BILLING_REQUIRED":
    case "ANALYTICS_PAID_PLAN": {
      const presented = agentErrorDetails(error.code, error.message);
      return rpcError(id, -32004, presented.message, 402, undefined, {
        ...(error.code === "ANALYTICS_PAID_PLAN" ? { code: error.code } : {}),
        details: presented.details,
      });
    }
    case "NOT_FOUND":
      return rpcError(id, -32005, error.message, 404);
    case "CONFLICT":
      return rpcError(id, -32009, error.message, 409);
    case "RATE_LIMIT": {
      const presented = agentErrorDetails(error.code, rateLimitMessage(error));
      return rpcError(id, -32010, presented.message, 429, apiRateLimitHeaders(error), { details: presented.details });
    }
    case "VALIDATION_ERROR":
      return rpcError(id, -32602, error.message, 400);
    default:
      return rpcError(id, -32000, "Tool failed", error.status >= 400 && error.status < 600 ? error.status : 500);
  }
}

/** requestId: the outer worker's X-Request-ID, used to correlate exception logs. */
export async function handleMcpRequest(request: Request, requestId: string | null = null) {
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

  const bearer = hasBearerAuthorization(request);
  const auth = bearer ? await authenticateMcp(request) : null;
  if (bearer && !auth) return rpcError(body.id, -32001, invalidApiKeyMessage(), 401, bearerChallenge(true));
  if (!auth) return rpcError(body.id, -32001, signInRequiredMessage(), 401, bearerChallenge(false));

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
      logUnhandledException({ surface: "mcp", requestId, method: request.method, url: request.url, cfRay: request.headers.get("cf-ray"), error });
      return rpcError(body.id, -32000, "Tool failed", 500);
    }
  }

  if (body.method !== "tools/call") {
    return rpcError(body.id, -32601, "Method not found", modern ? 404 : 200);
  }
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
      kind: apiUsageKind(name as McpToolName),
      force: forceQuotaForSmoke(request),
    });
    return result(
      body.id,
      await callTool(name as McpToolName, auth.actor, auth.siteId, auth.workspaceId, auth.tokenId, params.arguments),
      modern,
    );
  } catch (error) {
    const validationMessage = zodValidationMessage(error);
    if (validationMessage) return result(body.id, toolError('VALIDATION_ERROR', validationMessage), modern);
    if (error instanceof UploadError) {
      return result(body.id, toolError(error.code, FORM_STATUS[error.code]?.message ?? "Upload failed."), modern);
    }
    if (error instanceof AppError) return result(body.id, toolError(error.code,
      error instanceof RateLimitError ? rateLimitMessage(error) : error.message,
      (error as AppError & { details?: unknown }).details,
      error instanceof RateLimitError ? rateLimitRetryAfterSeconds(error)
        : (error as AppError & { retryAfterSeconds?: number }).retryAfterSeconds), modern);
    logUnhandledException({ surface: "mcp", requestId, method: request.method, url: request.url, cfRay: request.headers.get("cf-ray"), tool: name, error });
    return rpcError(body.id, -32000, "Tool failed", 500);
  }
}
