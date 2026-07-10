import { describe, expect, it, vi } from "vitest";
import { voiceProfileSettingsInputSchema } from "@vc/validators";

vi.mock("~/lib/markdown", () => ({
  renderRichContent: vi.fn(),
  RichContentFrame: () => null,
}));
vi.mock("~/components/dashboard/DashboardLayout", () => ({
  Button: () => null,
  EmptyState: () => null,
  LoadError: () => null,
  PageHeader: () => null,
  Panel: () => null,
}));
vi.mock("~/components/ui/tabs", () => ({
  Tabs: () => null,
  TabsContent: () => null,
  TabsList: () => null,
  TabsTrigger: () => null,
}));
vi.mock("~/components/dashboard/PendingSubmitButton", () => ({
  PendingSubmitButton: () => null,
}));
vi.mock("~/components/dashboard/SpaConfirmButton", () => ({
  SpaConfirmButton: () => null,
}));
vi.mock("~/server/dashboard-pages-fn", () => ({
  addCustomDomainMutation: vi.fn(),
  clearVoiceProfileMutation: vi.fn(),
  loadSettingsPage: vi.fn(),
  removeCustomDomainMutation: vi.fn(),
  updateSiteSettingsMutation: vi.fn(),
  updateVoiceProfileMutation: vi.fn(),
}));
vi.mock("~/lib/dashboard-search", () => ({
  emptyDashboardStatusSearch: {},
}));

import {
  parseVoiceRules,
  selectRepresentativePost,
  validateVoiceProfileForm,
} from "../components/dashboard/SettingsPage";

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

describe("Voice Profile form behavior", () => {
  it("keeps blank lines editable while validating the exact overlong line and disabling save", () => {
    const value = `Use active voice

${"a".repeat(201)}
Include examples`
    const validation = validateVoiceProfileForm(value, "")

    expect(parseVoiceRules(value)).toEqual([
      "Use active voice",
      "a".repeat(201),
      "Include examples",
    ]);
    expect(validation.prefer.lineNumbers).toEqual([3]);
    expect(validation.prefer.ruleCount).toBe(3);
    expect(validation.isValid).toBe(false);
  });

  it("enables saving at the multiline boundaries and rejects more than 12 non-blank rules", () => {
    expect(validateVoiceProfileForm(`One

${"a".repeat(200)}`, "Two").isValid).toBe(true);
    expect(
      validateVoiceProfileForm(
        Array.from({ length: 7 }, (_, index) => `Prefer ${index}`).join("\n"),
        Array.from({ length: 6 }, (_, index) => `Avoid ${index}`).join("\n"),
      ).isValid,
    ).toBe(false);
  });

  it("reports selection count through the capped representative-post selection", () => {
    const selected = ["one", "two", "three"];

    expect(selectRepresentativePost(selected, "four", true)).toEqual(selected);
    expect(selectRepresentativePost(selected, "two", false)).toEqual(["one", "three"]);
    expect(selectRepresentativePost(["one", "two"], "three", true)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
});
