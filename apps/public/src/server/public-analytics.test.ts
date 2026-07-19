import { describe, expect, it, vi } from "vitest";
import {
  normalizeReferrerHost,
  privacySignalEnabled,
  writePageView,
} from "./public-analytics";

describe("public analytics privacy contract", () => {
  it("keeps only an external hostname from a referrer", () => {
    expect(normalizeReferrerHost("news.example.com", "blog.example.com")).toBe("news.example.com");
    expect(normalizeReferrerHost("blog.example.com", "blog.example.com")).toBeNull();
    expect(normalizeReferrerHost("https://news.example.com/path", "blog.example.com")).toBeNull();
    expect(normalizeReferrerHost("not a host", "blog.example.com")).toBeNull();
  });

  it("honors DNT and Global Privacy Control headers", () => {
    expect(privacySignalEnabled(new Request("https://blog.example.com", { headers: { dnt: "1" } }))).toBe(true);
    expect(privacySignalEnabled(new Request("https://blog.example.com", { headers: { "sec-gpc": "1" } }))).toBe(true);
    expect(privacySignalEnabled(new Request("https://blog.example.com"))).toBe(false);
  });

  it("writes no IP address, user agent, cookie, or visitor identifier", () => {
    const writeDataPoint = vi.fn();
    writePageView({ writeDataPoint } as unknown as AnalyticsEngineDataset, {
      siteId: "site-1",
      postId: "post-1",
      postSlug: "hello-world",
      referrerHost: "chatgpt.com",
    });

    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["site-1"],
      blobs: ["page_view", "post-1", "hello-world", "chatgpt.com"],
      doubles: [1],
    });
  });
});
