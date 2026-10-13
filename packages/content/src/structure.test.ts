import { describe, expect, it } from "vitest";
import { resolveChrome, resolveIndex, resolveHeader, THEME_PRESETS } from "@vc/config";
import { templateAttributes } from "./presented-post";

describe("blog structure", () => {
  it("uses each template as the default and accepts independent valid overrides", () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(resolveChrome(null, preset.id)).toBe(preset.template.chrome);
      expect(resolveIndex(undefined, preset.id)).toBe(preset.template.index);
      expect(resolveHeader("invalid", preset.id)).toBe(preset.template.header);
    }
    expect(resolveChrome("sidebar", "minimal")).toBe("sidebar");
    expect(resolveIndex("grid", "minimal")).toBe("grid");
    expect(resolveHeader("card", "minimal")).toBe("card");
  });

  it("stamps overrides independently", () => {
    expect(templateAttributes("minimal", { accent: null, font: null, mode: null,
      chrome: "sidebar", index: "grid", header: "card" })).toMatchObject({
      "data-vc-theme": "minimal", "data-vc-chrome": "sidebar",
      "data-vc-index": "grid", "data-vc-header": "card",
    });
  });
});
