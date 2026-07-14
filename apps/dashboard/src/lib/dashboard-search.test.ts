import { describe, expect, it } from "vitest";
import { validateSettingsSearch } from "./dashboard-search";

describe("validateSettingsSearch", () => {
  it("preserves the Voice Profile tab", () => {
    expect(validateSettingsSearch({ tab: "voice" })).toEqual({
      ok: undefined,
      error: undefined,
      tab: "voice",
    });
  });

  it("drops unknown tabs without dropping status feedback", () => {
    expect(validateSettingsSearch({ tab: "unknown", ok: "voice_profile_saved" })).toEqual({
      ok: "voice_profile_saved",
      error: undefined,
      tab: undefined,
    });
  });
});
