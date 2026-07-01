/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

// MCP contract: every tool outputSchema must be a top-level object or Claude's
// client rejects the entire tools/list. Array/nullable DTOs wrap under `result`.
import { describe, it, expect } from "vitest";
import { handleMcpRequest } from "./mcp";

type ToolSchema = { type?: string; properties?: Record<string, { type?: string }> };
type Tool = { name: string; outputSchema?: ToolSchema };

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
});
