import { describe, expect, it } from "vitest";
import wrangler from "../../wrangler.jsonc?raw";

describe("public worker observability", () => {
  it("never records request URLs, which carry preview tokens", () => {
    const config = wrangler.replace(/^\s*\/\/.*$/gm, "");
    expect(config).toMatch(/"invocation_logs":\s*false/);
    expect(config).toMatch(/"traces":\s*\{\s*"enabled":\s*false/);
    expect(config).not.toMatch(/"invocation_logs":\s*true/);
  });
});
