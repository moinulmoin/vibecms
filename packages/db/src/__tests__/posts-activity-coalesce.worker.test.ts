/**
 * Post activity coalescing contract under real miniflare D1.
 *
 * updatePostWithHistory coalesces rapid same-actor `post.updated` activity
 * events (autosave, agent drafting) into one row within a 10-minute window so
 * the activity ledger stays a trust log, not a keystroke log. This suite
 * defends the behaviors that contract promises:
 *
 *   - no coalescing across the window boundary (old event + new update = 2 rows)
 *   - same-actor rapid updates bump the existing row while preserving the
 *     first before-state and refreshing the latest after-state
 *   - distinct lifecycle actions (post.published) always insert, even right
 *     after a coalesced post.updated (guards the NOT EXISTS overreach)
 *   - different actors, including different actor types sharing an id, never coalesce
 *
 * IDs are file-scoped ("pac-") so this suite never collides with the others
 * sharing the miniflare D1 instance.
 *
 * Run via:
 *   pnpm --filter @vc/db test
 */
/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

import { describe, it, expect, beforeAll, inject } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createDataAccess } from "@vc/db";
import type { Actor } from "@vc/core";

const SITE = "site-pac";
const POST = "post-pac";
const ACTOR: Actor = { type: "human", id: "pac-user", name: "PAC Human", role: "owner" };
const OTHER_ACTOR: Actor = { type: "api_key", id: "pac-key", name: "PAC Agent", scopes: [] };

const da = createDataAccess(env.DB);

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("ws-pac", "PAC Workspace", "ws-pac", 1_704_000_000, 1_704_000_000)
    .run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(SITE, "ws-pac", "PAC Site", "pac-site", 1_704_000_000, 1_704_000_000)
    .run();
  await env.DB.prepare(
    `INSERT INTO posts (id, site_id, title, slug, content_markdown, status, tags_json,
       created_by_type, created_by_id, updated_by_type, updated_by_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', '[]', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(POST, SITE, "Coalesce Post", "coalesce-post", "# body", ACTOR.type, ACTOR.id, ACTOR.type, ACTOR.id, 1_704_000_000, 1_704_000_000)
    .run();
});

async function updateHistory(actor: Actor, action: string, title: string, expectedVersion: number) {
  const result = await da.posts.updatePostWithHistory(
    SITE,
    POST,
    { title },
    actor,
    { changeSummary: "Updated post", activityAction: action, activitySummary: `Updated ${title}` },
    expectedVersion,
  );
  expect(result).not.toBeNull();
  return result!;
}

async function eventsForPost() {
  const { results } = await env.DB.prepare(
    `SELECT action, actor_type, actor_id, summary, before_json, after_json, created_at FROM activity_events
      WHERE site_id = ? AND entity_id = ? ORDER BY created_at ASC, rowid ASC`,
  )
    .bind(SITE, POST)
    .all<{
      action: string;
      actor_type: string;
      actor_id: string;
      summary: string;
      before_json: string | null;
      after_json: string | null;
      created_at: number;
    }>();
  return results;
}

describe("updatePostWithHistory — post.updated activity coalescing", () => {
  it("does not coalesce with an event older than the window", async () => {
    // Seed an event 1 hour old for the same actor + post.
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    await env.DB.prepare(
      `INSERT INTO activity_events (id, site_id, actor_type, actor_id, actor_name, action,
         entity_type, entity_id, summary, created_at)
       VALUES (?, ?, ?, ?, ?, 'post.updated', 'post', ?, ?, ?)`,
    )
      .bind("pac-act-old", SITE, ACTOR.type, ACTOR.id, ACTOR.name, POST, "Updated Coalesce Post", hourAgo)
      .run();

    await updateHistory(ACTOR, "post.updated", "Coalesce Post v2", 0);
    const events = await eventsForPost();
    expect(events).toHaveLength(2);
    expect(events[1].action).toBe("post.updated");
  });

  it("coalesces a rapid same-actor update into the existing row", async () => {
    const before = await eventsForPost();
    const latestCreatedAt = before[before.length - 1].created_at;

    await updateHistory(ACTOR, "post.updated", "Coalesce Post v3", 1);

    const after = await eventsForPost();
    expect(after).toHaveLength(2); // no new row
    expect(after[1].created_at).toBeGreaterThanOrEqual(latestCreatedAt); // bumped
    expect(after[1].summary).toBe("Updated Coalesce Post v3");
    expect(JSON.parse(after[1].before_json ?? "null").title).toBe("Coalesce Post");
    expect(JSON.parse(after[1].after_json ?? "null").title).toBe("Coalesce Post v3");
  });

  it("always inserts distinct lifecycle actions right after a coalesced update", async () => {
    // The publish must NOT be suppressed by the recent post.updated row.
    await updateHistory(ACTOR, "post.published", "Coalesce Post v3", 2);

    const events = await eventsForPost();
    expect(events).toHaveLength(3);
    expect(events[2].action).toBe("post.published");
  });

  it("never coalesces across actors", async () => {
    await updateHistory(OTHER_ACTOR, "post.updated", "Coalesce Post v4", 3);

    const events = await eventsForPost();
    expect(events).toHaveLength(4);
    expect(events[3].actor_id).toBe(OTHER_ACTOR.id);
  });

  it("never coalesces actors of different types that share an id", async () => {
    const sameIdApiKey: Actor = {
      type: "api_key",
      id: ACTOR.id,
      name: "PAC Same-ID Agent",
      scopes: [],
    };
    await updateHistory(sameIdApiKey, "post.updated", "Coalesce Post v5", 4);

    const events = await eventsForPost();
    expect(events).toHaveLength(5);
    expect(events[4]).toMatchObject({ actor_type: "api_key", actor_id: ACTOR.id });
  });
});
