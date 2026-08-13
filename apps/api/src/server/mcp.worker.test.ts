/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { operations, zodToInputJsonSchema } from "@vc/api-contract";
import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createD1PostRepository } from "@vc/db";
import { createPost, type Actor } from "@vc/core";
import { handleMcpRequest } from "@/server/mcp";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

type ToolSchema = {
  type?: string;
  items?: ToolSchema;
  properties?: Record<string, ToolSchema>;
  required?: string[];
  additionalProperties?: boolean;
};
type Tool = {
  name: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: ToolSchema;
  annotations: Record<string, boolean>;
  _meta: { "vibecms.com/requiredScope": string };
};

type RpcErrorBody = { jsonrpc: string; id: unknown; error: { code: number; message: string } };

async function toolsList(): Promise<Tool[]> {
  const request = new Request("https://app.vibecms.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const response = await handleMcpRequest(request);
  expect(response.status).toBe(200);
  const json = (await response.json()) as { result: { tools: Tool[] } };
  return json.result.tools;
}

async function initialize(): Promise<string> {
  const request = new Request("https://app.vibecms.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  const response = await handleMcpRequest(request);
  expect(response.status).toBe(200);
  const json = (await response.json()) as { result: { instructions: string } };
  return json.result.instructions;
}

function mcpRequest(body: unknown, headers: HeadersInit = { "content-type": "application/json" }) {
  return new Request("https://app.vibecms.dev/mcp", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const MODERN_PROTOCOL_VERSION = "2026-07-28";

function modernMcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  version = MODERN_PROTOCOL_VERSION,
) {
  return mcpRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientInfo": { name: "vibecms-test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": version,
      "Mcp-Method": method,
      ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
    },
  );
}

async function hashToken(token: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TOKEN_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const binary = String.fromCharCode(...new Uint8Array(signature));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("MCP tools/list inputSchema contract", () => {
  it("advertises posts.get_by_slug with the canonical slug schema and read scope", async () => {
    const tool = (await toolsList()).find((candidate) => candidate.name === "posts.get_by_slug");
    expect(tool).toMatchObject({
      name: "posts.get_by_slug",
      _meta: { "vibecms.com/requiredScope": "posts:read" },
    });
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
      additionalProperties: false,
    });
  });

  it("derives every advertised request from the canonical operation schema", async () => {
    const byName = new Map((await toolsList()).map((tool) => [tool.name, tool]));
    for (const operation of operations) {
      expect(byName.get(operation.toolName)?.inputSchema).toEqual(zodToInputJsonSchema(operation.requestSchema));
    }
  });

  it("preserves operation scope and behavior metadata", async () => {
    const byName = new Map((await toolsList()).map((tool) => [tool.name, tool]));
    for (const operation of operations) {
      const tool = byName.get(operation.toolName);
      const annotations = operation.annotations as Record<string, boolean>;
      expect(tool?._meta["vibecms.com/requiredScope"]).toBe(operation.requiredScope);
      expect(tool?.annotations.readOnlyHint ?? false).toBe(annotations.readOnly ?? false);
      expect(tool?.annotations.destructiveHint ?? false).toBe(annotations.destructive ?? false);
      expect(tool?.annotations.idempotentHint ?? false).toBe(annotations.idempotent ?? false);
    }
  });
});

describe("MCP posts.get_by_slug tool call", () => {
  const WORKSPACE_ID = "ws-mcp-by-slug";
  const SITE_ID = "site-mcp-by-slug";
  const TOKEN = "vc_live_mcp_by_slug_tool_call";
  const TOKEN_ID = "key-mcp-by-slug";
  const actor: Actor = {
    type: "api_key",
    id: TOKEN_ID,
    name: "MCP By Slug",
    scopes: ["sites:read", "posts:read", "posts:create"],
  };

  beforeAll(async () => {
    const migrations = inject("migrations") as D1Migration[];
    await applyD1Migrations(env.DB, migrations);
    const ts = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(WORKSPACE_ID, "MCP By Slug Workspace", "ws-mcp-by-slug", ts, ts)
      .run();
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(SITE_ID, WORKSPACE_ID, "MCP By Slug Site", "site-mcp-by-slug", ts, ts)
      .run();

    const tokenHash = await hashToken(TOKEN);
    await env.DB.prepare(
      "INSERT INTO api_keys (id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, last_used_at, revoked_at, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
    )
      .bind(
        TOKEN_ID,
        SITE_ID,
        "MCP By Slug",
        TOKEN.slice(0, 18),
        tokenHash,
        JSON.stringify(["sites:read", "posts:read", "posts:create"]),
        actor.name,
        "owner-mcp-by-slug",
        ts,
        ts,
      )
      .run();

    await createPost(createD1PostRepository(env.DB), actor, {
      siteId: SITE_ID,
      title: "MCP By Slug Post",
      slug: "mcp-by-slug",
      contentMarkdown: "# By slug",
    });
  });

  it("dispatches an authenticated exact-slug call to the full-post operation", async () => {
    const response = await handleMcpRequest(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 42,
          method: "tools/call",
          params: {
            name: "posts.get_by_slug",
            arguments: { slug: "mcp-by-slug" },
          },
        },
        {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
        },
      ),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      result: { structuredContent: { id: string; slug: string; contentMarkdown: string } };
    };
    expect(json.result.structuredContent).toMatchObject({
      slug: "mcp-by-slug",
      contentMarkdown: "# By slug",
    });
  });
});

describe("MCP initialize safety contract", () => {
  it("teaches approval, untrusted-data, and live-mutation boundaries", async () => {
    const instructions = await initialize();
    expect(instructions).toContain("untrusted data");
    expect(instructions).toContain("explicit approval for the exact latest version");
    expect(instructions).toContain("expectedVersionNumber");
    expect(instructions).toContain("mutate live state");
    expect(instructions).toContain("dashboard is the human control plane");
  });
});

describe("MCP 2026-07-28 stateless transport", () => {
  it("discovers supported versions and server capabilities per request", async () => {
    const response = await handleMcpRequest(modernMcpRequest("server/discover"));
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      result: {
        resultType: string;
        supportedVersions: string[];
        capabilities: Record<string, unknown>;
        ttlMs: number;
        cacheScope: string;
        _meta: Record<string, unknown>;
      };
    };
    expect(json.result).toMatchObject({
      resultType: "complete",
      capabilities: { tools: {} },
      ttlMs: 300_000,
      cacheScope: "public",
    });
    expect(json.result.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    expect(json.result.supportedVersions).not.toContain("2024-11-05");
    expect(json.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({
      name: "vibecms",
      version: "0.1.0",
    });
  });

  it("returns cacheable, deterministic tools with modern result metadata", async () => {
    const response = await handleMcpRequest(modernMcpRequest("tools/list"));
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      result: { resultType: string; tools: Tool[]; ttlMs: number; cacheScope: string };
    };
    const names = json.result.tools.map((tool) => tool.name);
    expect(json.result).toMatchObject({
      resultType: "complete",
      ttlMs: 300_000,
      cacheScope: "public",
    });
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  it("rejects missing or mismatched mirrored headers", async () => {
    const missingMethod = modernMcpRequest("tools/list");
    missingMethod.headers.delete("Mcp-Method");
    const missingResponse = await handleMcpRequest(missingMethod);
    expect(missingResponse.status).toBe(400);
    expect((await missingResponse.json()) as RpcErrorBody).toMatchObject({ error: { code: -32020 } });

    const mismatchedName = modernMcpRequest("tools/call", { name: "posts.list", arguments: {} });
    mismatchedName.headers.set("Mcp-Name", "posts.get");
    const mismatchResponse = await handleMcpRequest(mismatchedName);
    expect(mismatchResponse.status).toBe(400);
    expect((await mismatchResponse.json()) as RpcErrorBody).toMatchObject({ error: { code: -32020 } });
  });

  it("returns the standard unsupported-version error with supported revisions", async () => {
    const response = await handleMcpRequest(modernMcpRequest("tools/list", {}, "2099-01-01"));
    expect(response.status).toBe(400);
    const json = (await response.json()) as RpcErrorBody & {
      error: RpcErrorBody["error"] & { data: { requested: string; supported: string[] } };
    };
    expect(json.error.code).toBe(-32022);
    expect(json.error.data.requested).toBe("2099-01-01");
    expect(json.error.data.supported).toContain(MODERN_PROTOCOL_VERSION);
  });

  it("requires client capabilities in every modern request", async () => {
    const response = await handleMcpRequest(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
            },
          },
        },
        {
          "content-type": "application/json",
          "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
          "Mcp-Method": "tools/list",
        },
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()) as RpcErrorBody).toMatchObject({ error: { code: -32602 } });
  });

  it("removes initialize from modern semantics while preserving the legacy handshake", async () => {
    const modernResponse = await handleMcpRequest(modernMcpRequest("initialize"));
    expect(modernResponse.status).toBe(404);
    expect((await modernResponse.json()) as RpcErrorBody).toMatchObject({ error: { code: -32601 } });

    const legacyResponse = await handleMcpRequest(
      mcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      }),
    );
    const legacyJson = (await legacyResponse.json()) as { result: { protocolVersion: string; resultType?: string } };
    expect(legacyResponse.status).toBe(200);
    expect(legacyJson.result).toMatchObject({ protocolVersion: "2025-11-25" });
    expect(legacyJson.result.resultType).toBeUndefined();
  });

  it("rejects cross-origin browser requests", async () => {
    const request = modernMcpRequest("tools/list");
    request.headers.set("Origin", "https://evil.example");
    const response = await handleMcpRequest(request);
    expect(response.status).toBe(403);
  });
});

describe("MCP tools/list outputSchema contract", () => {
  it("every tool advertises a top-level object outputSchema", async () => {
    const tools = await toolsList();
    expect(tools.length).toBeGreaterThan(0);
    const bad = tools.filter((tool) => tool.outputSchema?.type !== "object").map((tool) => tool.name);
    expect(bad).toEqual([]);
  });

  it("wraps array and nullable DTOs under result, leaves objects unwrapped", async () => {
    const byName = new Map((await toolsList()).map((tool) => [tool.name, tool]));
    expect(byName.get("posts.list")?.outputSchema?.properties?.result?.type).toBe("array");
    expect(byName.get("sites.get")?.outputSchema?.properties?.result).toBeDefined();
    expect(byName.get("posts.get")?.outputSchema?.properties?.result).toBeUndefined();
  });

  it("advertises a public url field on post and site DTOs", async () => {
    const byName = new Map((await toolsList()).map((tool) => [tool.name, tool]));
    expect(byName.get("posts.get")?.outputSchema?.properties?.url).toBeDefined();
    expect(byName.get("posts.publish")?.outputSchema?.properties?.url).toBeDefined();
    expect(byName.get("sites.get")?.outputSchema?.properties?.result?.properties?.url).toBeDefined();
    expect(byName.get("posts.list")?.outputSchema?.properties?.result?.items?.properties?.url).toBeDefined();
  });
});

describe("MCP JSON-RPC envelope validation", () => {
  it("returns Invalid Request for JSON null instead of 500", async () => {
    const response = await handleMcpRequest(mcpRequest("null"));
    expect(response.status).toBe(400);
    const json = (await response.json()) as RpcErrorBody;
    expect(json).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
  });

  it("rejects batch arrays as Invalid Request", async () => {
    const response = await handleMcpRequest(
      mcpRequest([{ jsonrpc: "2.0", id: 1, method: "initialize" }]),
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as RpcErrorBody;
    expect(json.error.code).toBe(-32600);
  });

  it("rejects the wrong jsonrpc version", async () => {
    const response = await handleMcpRequest(
      mcpRequest({ jsonrpc: "1.0", id: 1, method: "initialize" }),
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as RpcErrorBody;
    expect(json).toMatchObject({ jsonrpc: "2.0", id: 1, error: { code: -32600 } });
  });

  it("rejects missing Content-Type", async () => {
    const response = await handleMcpRequest(
      new Request("https://app.vibecms.dev/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as RpcErrorBody;
    expect(json.error.code).toBe(-32600);
    expect(json.error.message).toMatch(/content-type/i);
  });

  it("rejects a non-JSON Content-Type", async () => {
    const response = await handleMcpRequest(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, { "content-type": "text/plain" }),
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as RpcErrorBody;
    expect(json.error.code).toBe(-32600);
  });
});

describe("MCP tools/list auth and quota", () => {
  const WORKSPACE_ID = "ws-mcp-list";
  const SITE_ID = "site-mcp-list";
  const TOKEN = "vc_live_mcp_list_quota_token";
  const TOKEN_ID = "key-mcp-list";

  beforeAll(async () => {
    const migrations = inject("migrations") as D1Migration[];
    await applyD1Migrations(env.DB, migrations);

    const ts = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(WORKSPACE_ID, "MCP List Workspace", "ws-mcp-list", ts, ts)
      .run();
    await env.DB.prepare(
      "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(SITE_ID, WORKSPACE_ID, "MCP List Site", "site-mcp-list", ts, ts)
      .run();

    const tokenHash = await hashToken(TOKEN);
    const keyCols =
      "id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, " +
      "last_used_at, revoked_at, created_by_user_id, created_at, updated_at";
    await env.DB.prepare(
      `INSERT INTO api_keys (${keyCols}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    )
      .bind(
        TOKEN_ID,
        SITE_ID,
        "MCP List",
        TOKEN.slice(0, 18),
        tokenHash,
        JSON.stringify(["sites:read", "posts:read", "activity:read"]),
        "MCP List",
        "owner-mcp-list",
        ts,
        ts,
      )
      .run();
  });

  it("allows unauthenticated tools/list for discovery", async () => {
    const response = await handleMcpRequest(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { result: { tools: Tool[] } };
    expect(json.result.tools.length).toBe(operations.length);
  });

  it("rejects an invalid bearer on tools/list instead of swallowing auth failure", async () => {
    const response = await handleMcpRequest(
      mcpRequest(
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { "content-type": "application/json", authorization: "Bearer vc_live_not_a_real_token" },
      ),
    );
    expect(response.status).toBe(401);
    const json = (await response.json()) as RpcErrorBody;
    expect(json).toMatchObject({ jsonrpc: "2.0", id: 3, error: { code: -32001 } });
  });

  it("meters authenticated tools/list as a read against the workspace budget", async () => {
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    };
    const first = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", id: 4, method: "tools/list" }, headers));
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { result: { tools: Tool[] } };
    // Read-only scopes: mutating tools are filtered out.
    expect(firstJson.result.tools.every((tool) => ["sites:read", "posts:read", "activity:read"].includes(tool._meta["vibecms.com/requiredScope"]))).toBe(true);
    expect(firstJson.result.tools.some((tool) => tool.name === "sites.get")).toBe(true);
    expect(firstJson.result.tools.some((tool) => tool.name === "posts.publish")).toBe(false);

    // API_USAGE_TEST_LIMIT=1: the second authenticated discovery must hit RATE_LIMIT.
    const second = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", id: 5, method: "tools/list" }, headers));
    expect(second.status).toBe(429);
    const secondJson = (await second.json()) as RpcErrorBody;
    expect(secondJson).toMatchObject({ jsonrpc: "2.0", id: 5, error: { code: -32010 } });
  });
});
