/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

// MCP contract: every tool outputSchema must be a top-level object or Claude's
// client rejects the entire tools/list. Array/nullable DTOs wrap under `result`.
import { operations } from "@vc/api-contract";
import { z } from "zod";
import { describe, it, expect } from "vitest";
import { handleMcpRequest } from "./mcp";

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
  const req = new Request("https://app.vibecms.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const res = await handleMcpRequest(req);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result: { tools: Tool[] } };
  return json.result.tools;
}

async function initialize(): Promise<string> {
  const req = new Request("https://app.vibecms.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  const res = await handleMcpRequest(req);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { result: { instructions: string } };
  return json.result.instructions;
}

describe("MCP tools/list inputSchema contract", () => {
  it("derives every advertised request from the canonical operation schema", async () => {
    const byName = new Map((await toolsList()).map((tool) => [tool.name, tool]));

    for (const operation of operations) {
      expect(byName.get(operation.toolName)?.inputSchema).toEqual(
        z.toJSONSchema(operation.requestSchema, { io: "input" }),
      );
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
    const bad = tools.filter((t) => t.outputSchema?.type !== "object").map((t) => t.name);
    expect(bad).toEqual([]);
  });

  it("wraps array and nullable DTOs under result, leaves objects unwrapped", async () => {
    const tools = await toolsList();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("posts.list")?.outputSchema?.properties?.result?.type).toBe("array");
    expect(byName.get("sites.get")?.outputSchema?.properties?.result).toBeDefined();
    expect(byName.get("posts.get")?.outputSchema?.properties?.result).toBeUndefined();
  });

  it("advertises a public url field on post and site DTOs", async () => {
    const byName = new Map((await toolsList()).map((t) => [t.name, t]));
    expect(byName.get("posts.get")?.outputSchema?.properties?.url).toBeDefined();
    expect(byName.get("posts.publish")?.outputSchema?.properties?.url).toBeDefined();
    expect(byName.get("sites.get")?.outputSchema?.properties?.result?.properties?.url).toBeDefined();
    expect(byName.get("posts.list")?.outputSchema?.properties?.result?.items?.properties?.url).toBeDefined();
  });
});
