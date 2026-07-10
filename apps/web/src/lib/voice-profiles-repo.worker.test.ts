/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import {
  createVoiceProfilesRepository,
} from "@vc/db";
import { beforeAll, describe, expect, inject, it } from "vitest";

const SITE_ID = "voice-site-main";
const OTHER_SITE_ID = "voice-site-other";
const T0 = 1_706_000_000;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);

  await env.DB.prepare(
    "INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("voice-workspace", "Voice Workspace", "voice-workspace", T0, T0)
    .run();

  for (const [id, slug] of [
    [SITE_ID, "voice-main"],
    [OTHER_SITE_ID, "voice-other"],
  ] as const) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, "voice-workspace", id, slug, T0, T0)
      .run();
  }

  for (const post of [
    { id: "voice-published-a", siteId: SITE_ID, slug: "published-a", status: "published" },
    { id: "voice-published-b", siteId: SITE_ID, slug: "published-b", status: "published" },
    { id: "voice-draft", siteId: SITE_ID, slug: "draft", status: "draft" },
    { id: "voice-other-post", siteId: OTHER_SITE_ID, slug: "other", status: "published" },
  ] as const) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO posts (id, site_id, title, slug, content_markdown, status, tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', 'human', 'voice-user', 'human', 'voice-user', ?, ?)",
    )
      .bind(post.id, post.siteId, post.id, post.slug, `# ${post.id}`, post.status, T0, T0)
      .run();
  }
});

describe("VoiceProfilesRepository", () => {
  it("returns null when a site has no configured profile", async () => {
    const repository = createVoiceProfilesRepository(env.DB);
    await expect(repository.getBySite(OTHER_SITE_ID)).resolves.toBeNull();
  });

  it("saves explicit guidance and preserves representative post order", async () => {
    const repository = createVoiceProfilesRepository(env.DB);

    await repository.save({
      siteId: SITE_ID,
      audience: "Independent technical founders",
      voiceSummary: "Direct, evidence-led, and calm.",
      guidelines: [
        { kind: "prefer", text: "Use concrete examples", source: { kind: "explicit" } },
        { kind: "avoid", text: "Avoid promotional filler", source: { kind: "explicit" } },
      ],
      representativePostIds: ["voice-published-b", "voice-published-a"],
      editor: { type: "human", id: "voice-user", name: "Voice Owner" },
      timestamp: T0 + 10,
      activityId: "voice-activity-save",
    });

    const profile = await repository.getBySite(SITE_ID);
    expect(profile).toMatchObject({
      audience: "Independent technical founders",
      voiceSummary: "Direct, evidence-led, and calm.",
      representativePostIds: ["voice-published-b", "voice-published-a"],
      guidelines: [
        { kind: "prefer", text: "Use concrete examples", source: { kind: "explicit" } },
        { kind: "avoid", text: "Avoid promotional filler", source: { kind: "explicit" } },
      ],
      warnings: [],
      updatedBy: { type: "human", id: "voice-user", name: "Voice Owner" },
    });
    expect(profile?.representativePosts.map((post) => post.id)).toEqual([
      "voice-published-b",
      "voice-published-a",
    ]);
  });

  it.each([
    ["an unpublished post", ["voice-draft"]],
    ["a post from another site", ["voice-other-post"]],
    ["a missing post", ["voice-missing"]],
  ])("filters %s from representative exemplars", async (_label, representativePostIds) => {
    const repository = createVoiceProfilesRepository(env.DB);

    await repository.save({
      siteId: SITE_ID,
      audience: null,
      voiceSummary: null,
      guidelines: [],
      representativePostIds,
      editor: { type: "human", id: "voice-user", name: "Voice Owner" },
      timestamp: T0 + 20,
      activityId: crypto.randomUUID(),
    });

    const saved = await repository.getBySite(SITE_ID);
    expect(saved).not.toBeNull();
    expect(saved?.representativePostIds).toEqual([]);
  });

  it("clears the profile and records that no configuration remains", async () => {
    const repository = createVoiceProfilesRepository(env.DB);
    await expect(
      repository.clear({
        siteId: SITE_ID,
        editor: { type: "human", id: "voice-user", name: "Voice Owner" },
        timestamp: T0 + 30,
        activityId: "voice-activity-clear",
      }),
    ).resolves.toBe(true);
    await expect(repository.getBySite(SITE_ID)).resolves.toBeNull();
  });
});
