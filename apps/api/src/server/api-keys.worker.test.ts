/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import type { Actor } from "@vc/core";
import type { AppUserContext } from "@/server/onboarding";
import { listApiKeys, revokeApiKeyForApp } from "@/server/api-keys";
import { insertApiKeyWithActivity } from "@/server/api-key-atomic";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

const SITE_ID = "site-tokens";
const WORKSPACE_ID = "ws-tokens";

function ownerApp(): AppUserContext {
  const actor: Actor = { type: "human", id: "owner-tokens", name: "Owner", role: "owner" };
  return {
    user: { id: "owner-tokens", name: "Owner", email: "owner@example.com" },
    siteId: SITE_ID,
    workspaceId: WORKSPACE_ID,
    actor,
  };
}

function editorApp(): AppUserContext {
  const actor: Actor = { type: "human", id: "editor-tokens", name: "Editor", role: "editor" };
  return {
    user: { id: "editor-tokens", name: "Editor", email: "editor@example.com" },
    siteId: SITE_ID,
    workspaceId: WORKSPACE_ID,
    actor,
  };
}

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(WORKSPACE_ID, "Token Workspace", "ws-tokens", ts, ts)
    .run();
  await env.DB.prepare(
    "INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(SITE_ID, WORKSPACE_ID, "Token Site", "site-tokens", ts, ts)
    .run();

  const keyCols =
    "id, site_id, name, token_prefix, token_hash, scopes_json, actor_name, " +
    "last_used_at, revoked_at, created_by_user_id, created_at, updated_at";
  await env.DB.prepare(
    `INSERT INTO api_keys (${keyCols}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
  )
    .bind("key-keep", SITE_ID, "Keep", "vc_live_keep", "hash-keep", "[]", "Keep", "owner-tokens", ts, ts)
    .run();
  await env.DB.prepare(
    `INSERT INTO api_keys (${keyCols}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
  )
    .bind("key-revoke", SITE_ID, "Revoke", "vc_live_revoke", "hash-revoke", "[]", "Revoke", "owner-tokens", ts, ts)
    .run();
});

describe("api-keys revoke and list", () => {
  it("revoke removes the token from listApiKeys while retaining the row for attribution", async () => {
    const result = await revokeApiKeyForApp(ownerApp(), "key-revoke");
    expect(result).toEqual({ kind: "ok", code: "token_revoked" });

    const listed = await listApiKeys(ownerApp());
    const ids = listed.map((key) => key.id);
    expect(ids).toContain("key-keep");
    expect(ids).not.toContain("key-revoke");
    expect(ids).toHaveLength(1);

    const row = await env.DB.prepare("SELECT revoked_at FROM api_keys WHERE id = ?")
      .bind("key-revoke")
      .first<{ revoked_at: number | null }>();
    expect(row?.revoked_at).not.toBeNull();
  });

  it("rejects revoke from a non-owner with owner_required and leaves the row active", async () => {
    const result = await revokeApiKeyForApp(editorApp(), "key-keep");
    expect(result).toEqual({ kind: "error", code: "owner_required" });

    const row = await env.DB.prepare("SELECT revoked_at FROM api_keys WHERE id = ?")
      .bind("key-keep")
      .first<{ revoked_at: number | null }>();
    expect(row?.revoked_at).toBeNull();
  });

  it("enforces the active-token cap inside the insert batch", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const changes = await insertApiKeyWithActivity(
      {
        id: "key-over-limit",
        siteId: SITE_ID,
        name: "Over limit",
        tokenPrefix: "vc_live_limit",
        tokenHash: "hash-limit",
        scopesJson: "[]",
        actorName: "Owner",
        createdByUserId: "owner-tokens",
        timestamp,
      },
      ownerApp().actor,
      "activity-over-limit",
      1,
    );

    expect(changes).toBe(0);
    expect(
      await env.DB.prepare("SELECT id FROM api_keys WHERE id = ?").bind("key-over-limit").first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM activity_events WHERE id = ?").bind("activity-over-limit").first(),
    ).toBeNull();
  });
});
