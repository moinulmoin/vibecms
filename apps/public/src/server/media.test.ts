import { describe, expect, it } from "vitest";
import { negotiateTransformFormat } from "./media";

describe("negotiateTransformFormat", () => {
  it("prefers AVIF over WebP when both are accepted", () => {
    expect(negotiateTransformFormat("image/avif,image/webp,image/apng,*/*;q=0.8")).toBe("image/avif");
  });

  it("selects WebP when AVIF is absent", () => {
    expect(negotiateTransformFormat("image/webp,image/*;q=0.8,*/*;q=0.5")).toBe("image/webp");
  });

  it("returns null when neither AVIF nor WebP is accepted", () => {
    expect(negotiateTransformFormat(null)).toBeNull();
    expect(negotiateTransformFormat("")).toBeNull();
    expect(negotiateTransformFormat("image/png,image/jpeg")).toBeNull();
    expect(negotiateTransformFormat("*/*")).toBeNull();
  });

  it("honors quality values and rejects explicitly unsupported formats", () => {
    expect(negotiateTransformFormat("text/html, image/webp;q=0.8, */*;q=0.5")).toBe("image/webp");
    expect(negotiateTransformFormat("image/avif;q=0.9,image/webp;q=0.8")).toBe("image/avif");
    expect(negotiateTransformFormat("image/avif;q=0.2,image/webp;q=0.9")).toBe("image/webp");
    expect(negotiateTransformFormat("image/avif;q=0,image/webp;q=0")).toBeNull();
    expect(negotiateTransformFormat("image/avif;q=invalid,image/webp")).toBe("image/webp");
  });
});
