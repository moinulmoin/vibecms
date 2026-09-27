import { mcpInstructions } from "@vc/mcp";
import { describe, expect, it } from "vitest";

// The mcp package has no test runner; the API (which serves these instructions) checks them.
describe("MCP server instructions", () => {
  it("teach first contact, saved version approval, preview secrecy, and scope visibility", () => {
    for (const text of [
    'Authorization: Bearer <key>',
    'tools/list only shows tools this key can use',
    'call posts.get and preview that response',
    'Record currentVersionNumber from the same posts.get response',
    'These changes affect the live site. Get explicit owner approval for the specific change before calling. Having the scope is not approval.',
    'previewUrl is a secret bearer link',
    'Uploaded images are public before post publication',
  ]) expect(mcpInstructions).toContain(text);
  });
});
