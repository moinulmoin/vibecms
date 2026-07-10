import { mapSiteRow } from "@vc/api-contract";
import { describe, expect, it } from "vitest";

const site = {
  id: "site-voice",
  name: "Voice Site",
  slug: "voice-site",
  description: "A publication for careful builders.",
  createdAt: 100,
  updatedAt: 200,
};

describe("sites.get Voice Profile contract", () => {
  it("returns an explicit unconfigured profile for existing sites without one", () => {
    const result = mapSiteRow(site, "https://voice.example.com");
    expect(result?.voiceProfile).toEqual({
      configured: false,
      audience: null,
      voiceSummary: null,
      guidelines: [],
      representativePosts: [],
      warnings: [],
      updatedByName: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("returns human-managed guidance without exposing the editor id", () => {
    const result = mapSiteRow(site, "https://voice.example.com", {
      audience: "Independent technical founders",
      voiceSummary: "Direct and evidence-led.",
      guidelines: [
        { kind: "prefer", text: "Use concrete examples", source: { kind: "explicit" } },
      ],
      representativePosts: [
        { id: "post-1", title: "A representative post", slug: "representative", updatedAt: 300 },
      ],
      warnings: [],
      updatedBy: { type: "human", id: "private-user-id", name: "Publication owner" },
      createdAt: 250,
      updatedAt: 300,
    });

    expect(result?.voiceProfile).toMatchObject({
      configured: true,
      audience: "Independent technical founders",
      voiceSummary: "Direct and evidence-led.",
      updatedByName: "Publication owner",
    });
    expect(result?.voiceProfile).not.toHaveProperty("updatedBy");
    expect(JSON.stringify(result?.voiceProfile)).not.toContain("private-user-id");
  });
});
