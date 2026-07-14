/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { operations, zodToInputJsonSchema } from "@vc/api-contract";
import { describe, it, expect } from "vitest";
import { handleMcpRequest } from "@/server/mcp";

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
