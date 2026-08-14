/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import type { Actor } from "@vc/core";
import {
  completeSiteSetupForApp,
  updateSiteSettingsForApp,
  type AppUserContext,
} from "@/server/onboarding";
import { loadOnboardingStatus } from "@/server/dashboard-api";
import { clearVoiceProfileForApp, updateVoiceProfileForApp } from "@/server/voice-profile";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const SITE_ID = "site-ob-status";
const WORKSPACE_ID = "ws-ob-status";
// Epoch anchors so createdAt/lastUsedAt comparisons are deterministic and never
// depend on Date.now().
const T = 1_704_000_000;

const KEY_ACTIVE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KEY_SAME_SEC = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KEY_REVOKED = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function ownerApp(): AppUserContext {
  const actor: Actor = { type: "human", id: "owner-ob", name: "Owner", role: "owner" };
  return {
    user: { id: "owner-ob", name: "Owner", email: "owner@example.com" },
    siteId: SITE_ID,
    workspaceId: WORKSPACE_ID,
    actor,
  };
}

function editorApp(): AppUserContext {
  const actor: Actor = { type: "human", id: "editor-ob", name: "Editor", role: "editor" };
  return {
    user: { id: "editor-ob", name: "Editor", email: "editor@example.com" },
    siteId: SITE_ID,
    workspaceId: WORKSPACE_ID,
    actor,
  };
}

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(WORKSPACE_ID, "OB Workspace", "ws-ob-status", T, T)
    .run();
  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(SITE_ID, WORKSPACE_ID, "OB Site", SITE_ID, T, T)
    .run();

  const keyCols =
    "id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, " +
    "last_used_at, revoked_at, created_by_user_id, created_at, updated_at";
  // Newest ACTIVE key, never used -> 'waiting' under no-keyId resolution.
  await env.DB.prepare(
    `INSERT INTO api_keys (${keyCols}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
  )
    .bind(KEY_ACTIVE, SITE_ID, "Active A", "vc_live_a", "hash-ob-a", "[]", "A", "owner-ob", T + 100, T + 100)
    .run();
  // ACTIVE key used in the SAME SECOND it was created -> must be 'connected'
  // (the old lastUsedAt > createdAt check falsely reported 'waiting').
  await env.DB.prepare(
    `INSERT INTO api_keys (${keyCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  )
    .bind(KEY_SAME_SEC, SITE_ID, "SameSec", "vc_live_b", "hash-ob-b", "[]", "B", T, "owner-ob", T, T)
    .run();
  // REVOKED key (older than Active A). Selecting it exactly must report 'revoked'
  // even though a newer active key exists.
  await env.DB.prepare(
    `INSERT INTO api_keys (${keyCols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(KEY_REVOKED, SITE_ID, "Revoked", "vc_live_c", "hash-ob-c", "[]", "C", T + 60, T + 200, "owner-ob", T + 50, T + 200)
    .run();
});

describe("loadOnboardingStatus — connection + exact-key resolution", () => {
  it("reports 'connected' for a same-second authenticated use (lastUsedAt != null, not > createdAt)", async () => {
    const status = await loadOnboardingStatus(ownerApp(), KEY_SAME_SEC);
    // Exact selected key.
    expect(status.key?.id).toBe(KEY_SAME_SEC);
    // lastUsedAt === createdAt here; the fix is the != null predicate.
    expect(status.connection).toBe("connected");
  });

  it("reports 'revoked' for an exact revoked key even when a newer active key exists", async () => {
    const status = await loadOnboardingStatus(ownerApp(), KEY_REVOKED);
    // Never falls back to the active key: the exact revoked row is returned.
    expect(status.key?.id).toBe(KEY_REVOKED);
    expect(status.key?.revokedAt).not.toBeNull();
    expect(status.connection).toBe("revoked");
  });

  it("without keyId resolves the newest ACTIVE key (waiting, not revoked)", async () => {
    const status = await loadOnboardingStatus(ownerApp());
    expect(status.key?.id).toBe(KEY_ACTIVE);
    expect(status.connection).toBe("waiting");
  });

  it("returns the shared {key, connection, firstPost} contract shape", async () => {
    const status = await loadOnboardingStatus(ownerApp(), KEY_SAME_SEC);
    // No api_key posts seeded on this site -> durable proof is 'waiting'.
    expect(status.firstPost.state).toBe("waiting");
    // Exact contract field set.
    expect(Object.keys(status).sort()).toEqual(
      ["canManage", "connection", "firstPost", "key", "mcpUrl", "publicBaseUrl"].sort(),
    );
    expect(status.key).toEqual(expect.objectContaining({ id: KEY_SAME_SEC, name: "SameSec" }));
    expect(status.connection).toBe("connected");
    // publicBaseUrl is null until a public default domain resolves (never fabricated).
    expect(status.publicBaseUrl).toBeNull();
  });
});

describe("owner-only site configuration mutations", () => {
  it("rejects setup and settings changes from an editor", async () => {
    await expect(
      completeSiteSetupForApp(editorApp(), { name: "Edited", slug: "edited" }),
    ).resolves.toEqual({ kind: "error", code: "owner_required" });

    await expect(
      updateSiteSettingsForApp(editorApp(), {
        name: "Edited",
        defaultSeoTitle: "Edited",
        theme: "minimal",
      }),
    ).resolves.toEqual({ kind: "error", code: "owner_required" });
  });

  it("rejects voice-profile changes from an editor", async () => {
    await expect(updateVoiceProfileForApp(editorApp(), {
      preferRules: [],
      avoidRules: [],
      representativePostIds: [],
    })).resolves.toEqual({
      kind: "error",
      code: "owner_required",
    });
    await expect(clearVoiceProfileForApp(editorApp())).resolves.toEqual({
      kind: "error",
      code: "owner_required",
    });
  });
});
