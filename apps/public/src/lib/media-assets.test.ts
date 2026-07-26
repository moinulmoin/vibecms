import { describe, expect, it } from "vitest";
import {
  MEDIA_RESPONSIVE_WIDTHS,
  buildResponsiveMediaUrls,
  isAllowedMediaWidth,
  mediaAssetPath,
  parseMediaWidthParam,
  resolveResponsiveMediaSource,
} from "./media-assets";

describe("media responsive widths", () => {
  it("exposes a small allowlist suitable for cards and article images", () => {
    expect(MEDIA_RESPONSIVE_WIDTHS).toEqual([320, 640, 960, 1280]);
    for (const width of MEDIA_RESPONSIVE_WIDTHS) {
      expect(isAllowedMediaWidth(width)).toBe(true);
    }
  });

  it("rejects widths outside the allowlist", () => {
    expect(isAllowedMediaWidth(0)).toBe(false);
    expect(isAllowedMediaWidth(100)).toBe(false);
    expect(isAllowedMediaWidth(321)).toBe(false);
    expect(isAllowedMediaWidth(2000)).toBe(false);
  });
});

describe("parseMediaWidthParam", () => {
  it("treats missing or empty values as the original asset", () => {
    expect(parseMediaWidthParam(null)).toBeNull();
    expect(parseMediaWidthParam(undefined)).toBeNull();
    expect(parseMediaWidthParam("")).toBeNull();
  });

  it("accepts only allowlisted integer widths", () => {
    expect(parseMediaWidthParam("320")).toBe(320);
    expect(parseMediaWidthParam("640")).toBe(640);
    expect(parseMediaWidthParam("960")).toBe(960);
    expect(parseMediaWidthParam("1280")).toBe(1280);
  });

  it("rejects invalid or unbounded width values", () => {
    expect(parseMediaWidthParam("abc")).toBe("invalid");
    expect(parseMediaWidthParam("320px")).toBe("invalid");
    expect(parseMediaWidthParam("320.5")).toBe("invalid");
    expect(parseMediaWidthParam("-320")).toBe("invalid");
    expect(parseMediaWidthParam("0320")).toBe(320);
    expect(parseMediaWidthParam("9999")).toBe("invalid");
    expect(parseMediaWidthParam("1e3")).toBe("invalid");
  });
});

describe("buildResponsiveMediaUrls", () => {
  it("returns deterministic original src and srcSet variant URLs", () => {
    expect(buildResponsiveMediaUrls("asset-1")).toEqual({
      src: "/media-assets/asset-1",
      srcSet:
        "/media-assets/asset-1?w=320 320w, /media-assets/asset-1?w=640 640w, /media-assets/asset-1?w=960 960w, /media-assets/asset-1?w=1280 1280w",
      widths: MEDIA_RESPONSIVE_WIDTHS,
    });
    expect(mediaAssetPath("asset-1")).toBe("/media-assets/asset-1");
    expect(mediaAssetPath("asset-1", 640)).toBe("/media-assets/asset-1?w=640");
  });
});

describe("resolveResponsiveMediaSource", () => {
  it("resolves first-party Markdown media and rejects other sources", () => {
    expect(resolveResponsiveMediaSource("/media-assets/asset-1")).toMatchObject({
      src: "/media-assets/asset-1",
      srcSet: expect.stringContaining("/media-assets/asset-1?w=960 960w"),
      sizes: "(max-width: 720px) calc(100vw - 32px), 720px",
    });
    expect(resolveResponsiveMediaSource("https://example.com/image.png")).toBeNull();
    expect(resolveResponsiveMediaSource("/media-assets/asset-1?w=640")).toBeNull();
    expect(resolveResponsiveMediaSource("/other/asset-1")).toBeNull();
  });
});
