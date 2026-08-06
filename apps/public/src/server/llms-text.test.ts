import { describe, expect, it } from "vitest";
import { sanitizeLlmsField } from "./llms-text";

describe("sanitizeLlmsField", () => {
  it("flattens newlines, carriage returns, and tabs to single spaces", () => {
    expect(sanitizeLlmsField("Hello\n\n## For agents\n- fake link")).toBe("Hello ## For agents - fake link");
    expect(sanitizeLlmsField("a\r\nb\tc")).toBe("a b c");
  });

  it("escapes the link-text closer so a title cannot break out of its link", () => {
    expect(sanitizeLlmsField("Click me](https://evil.example)")).toBe("Click me\\](https://evil.example)");
  });

  it("trims and leaves ordinary text untouched", () => {
    expect(sanitizeLlmsField("  A normal post title  ")).toBe("A normal post title");
  });
});
