import { describe, expect, it } from "vitest";
import { voiceProfileSettingsInputSchema } from "@vc/validators";

describe("Voice Profile settings validation", () => {
  it("rejects guideline lines exceeding 200 characters", () => {
    const longLine = "a".repeat(201);
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: [longLine],
      avoidRules: [],
      representativePostIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0].message).toMatch(/200/);
    }
  });

  it("accepts guideline lines at exactly 200 characters", () => {
    const exactLine = "a".repeat(200);
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: [exactLine],
      avoidRules: [],
      representativePostIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("enforces total guideline cap of 12", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: Array(7).fill("rule1"),
      avoidRules: Array(6).fill("rule2"),
      representativePostIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0].message).toMatch(/12/);
    }
  });

  it("accepts exactly 12 total guidelines", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: Array(6).fill("rule1"),
      avoidRules: Array(6).fill("rule2"),
      representativePostIds: [],
    });
    expect(result.success).toBe(true);
  });

  it("enforces 3-post cap for representative posts", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: [],
      avoidRules: [],
      representativePostIds: ["post1", "post2", "post3", "post4"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 3 representative posts", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: [],
      avoidRules: [],
      representativePostIds: ["post1", "post2", "post3"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate representative post IDs", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: [],
      avoidRules: [],
      representativePostIds: ["post1", "post1"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0].message).toMatch(/unique/);
    }
  });

  it("trims whitespace from audience and voiceSummary", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "  Test audience  ",
      voiceSummary: "  Test summary  ",
      preferRules: ["  rule  "],
      avoidRules: [],
      representativePostIds: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audience).toBe("Test audience");
      expect(result.data.voiceSummary).toBe("Test summary");
      expect(result.data.preferRules[0]).toBe("rule");
    }
  });

  it("allows empty optional fields", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      preferRules: [],
      avoidRules: [],
      representativePostIds: [],
    });
    expect(result.success).toBe(true);
  });
});
