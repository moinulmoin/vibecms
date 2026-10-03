import { AGENT_TOOL_COUNT } from "@vc/config";
import { describe, expect, it } from "vitest";
import { mcpToolNames } from "./operations";

describe("AGENT_TOOL_COUNT", () => {
  it("matches the operation registry the landing page advertises", () => {
    expect(mcpToolNames.length).toBe(AGENT_TOOL_COUNT);
  });
});
