/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { operations, zodToInputJsonSchema } from "@vc/api-contract";
import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
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
