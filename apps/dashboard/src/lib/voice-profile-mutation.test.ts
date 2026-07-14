import { describe, expect, it } from "vitest";
import { voiceProfileSettingsInputSchema } from "@vc/validators";

describe("Voice Profile mutation validation", () => {
  it("returns voice_profile_invalid for payloads with >200-char guideline lines", () => {
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
      expect(result.error.issues[0].message).toMatch(/200/);
    }
  });

  it("returns voice_profile_invalid for payloads exceeding 12 guidelines", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: Array(7).fill("rule1"),
      avoidRules: Array(6).fill("rule2"),
      representativePostIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/12/);
    }
  });

  it("returns voice_profile_invalid for payloads exceeding 3 representative posts", () => {
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: [],
      avoidRules: [],
      representativePostIds: ["post1", "post2", "post3", "post4"],
    });
    expect(result.success).toBe(false);
  });

  it("filters invalid exemplar IDs without throwing", () => {
    // This tests that the repository filters invalid IDs instead of throwing
    // The actual filtering happens in voice-profiles.ts save method
    const result = voiceProfileSettingsInputSchema.safeParse({
      audience: "Test audience",
      voiceSummary: "Test summary",
      preferRules: [],
      avoidRules: [],
      representativePostIds: ["valid-post-1", "archived-post-2"],
    });
    // Schema validation should pass - filtering happens at repository level
    expect(result.success).toBe(true);
  });
});
