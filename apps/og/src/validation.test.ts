import { describe, expect, it } from "vitest";
import { validateOgCardModel } from "./validation";
const model = {
  kind: "post", mode: "light", colors: { bg: "#ffffff", fg: "#000000", muted: "#777777", hairline: "#eeeeee", accent: "#ff0000" },
  fonts: { heading: "Geist", body: "Geist" }, headingWeight: 650, radius: 6, siteName: "Site", host: "site.test",
  title: "Title", titleSize: 88, description: null, descriptionLines: 2, meta: null,
};
describe("OG RPC input", () => {
  it("accepts a bounded card model", () => expect(validateOgCardModel(model)).toEqual(model));
  it("rejects unsupported fonts, enums, colors, and oversize strings", () => {
    for (const change of [
      { fonts: { heading: "Unknown", body: "Geist" } }, { kind: "other" },
      { colors: { ...model.colors, bg: "url(foo)" } }, { title: "a".repeat(161) },
      { extra: true }, { descriptionLines: 100 },
    ]) expect(() => validateOgCardModel({ ...model, ...change })).toThrow(TypeError);
  });
});
