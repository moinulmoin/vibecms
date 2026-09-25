import { describe, expect, it } from "vitest";
import { renderRichContent } from "@vc/content";
import { createMathRenderer } from "@vc/content/math";
import { formatGuideForPreset, GUIDE_VERSION, RENDERER_VERSION } from "./format-guide";

describe("format guide v4", () => {
  const guide = formatGuideForPreset("minimal");

  it("advertises guide and renderer v4 with a structured syntax list", () => {
    expect(GUIDE_VERSION).toBe("4");
    expect(RENDERER_VERSION).toBe("4");
    expect(guide.guideVersion).toBe("4");
    const ids = guide.syntax?.map((s) => s.id) ?? [];
    for (const id of ["math", "mermaid", "tabs", "code-group", "package-install", "steps", "heading-id", "heading-toc-hide", "code-inline-lang"]) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("new-syntax examples render cleanly", () => {
    const start = guide.examples.indexOf("=== Math");
    const end = guide.examples.indexOf("=== Inline HTML");
    const section = guide.examples.slice(start, end).replace(/^=== .*===$/gm, "");
    const result = renderRichContent(section, { math: createMathRenderer() });
    expect(result.warnings).toEqual([]);
  });
});
