import { describe, expect, it } from "vitest";
import wrangler from "../../wrangler.jsonc?raw";

describe("public worker observability", () => {
  it("never records request URLs, which carry preview tokens", () => {
    const config = wrangler.replace(/^\s*\/\/.*$/gm, "");
    expect(config).toMatch(/"invocation_logs":\s*false/);
    expect(config).toMatch(/"traces":\s*\{\s*"enabled":\s*false/);
    expect(config).not.toMatch(/"invocation_logs":\s*true/);
  });

  it("keeps invocation logs off on the API worker in every environment", async () => {
    const api = (await import("../../../api/wrangler.jsonc?raw")).default.replace(/^\s*\/\/.*$/gm, "");
    const blocks = api.match(/"observability":\s*\{[^}]*\{[^}]*\}[^}]*\}/g) ?? [];
    expect(blocks.length).toBe(3);
    for (const block of blocks) expect(block).toMatch(/"invocation_logs":\s*false/);
  });
});
