/**
 * Dashboard publish version conflict test.
 *
 * Tests that the dashboard carries the exact version number corresponding
 * to rendered/reviewed content into publish confirmation, and that an
 * intervening edit yields version_conflict.
 *
 * Run via:
 *   pnpm --filter @vc/api test dashboard-publish-version
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
import { createD1PostRepository } from "@vc/db";
import {
  createPost,
  publishPost,
  ConflictError,
} from "@vc/core";
import type { Actor } from "@vc/core";

const T0 = 1700000000;

const humanActor: Actor = { type: "human", id: "test-user", name: "Test User", role: "owner" };

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);

  const ts = T0;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("test-ws", "Test Workspace", "test-ws", ts, ts)
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind("test-site", "test-ws", "Test Site", "test-site", ts, ts)
    .run();
});

describe("dashboard publish version conflict", () => {
  it("publishes with the exact version number loaded by the editor", async () => {
    const repo = createD1PostRepository(env.DB);

    // Create a draft post (version 1)
    const post = await createPost(repo, humanActor, {
      siteId: "test-site",
      title: "Test Post",
      slug: "test-post",
      contentMarkdown: "# Original",
    });
    expect(post.status).toBe("draft");

    // Simulate editor loading: fetch current version
    const versions = await repo.listPostVersions("test-site", post.id);
    const currentVersionNumber = versions[0]?.versionNumber ?? null;
    expect(currentVersionNumber).toBe(1);

    // Publish with the loaded version number
    const published = await publishPost(repo, humanActor, {
      siteId: "test-site",
      postId: post.id,
      expectedVersionNumber: currentVersionNumber,
      billingStatus: "active",
    });
    expect(published.status).toBe("published");
  });

  it("rejects publish when version number is stale (concurrent edit)", async () => {
    const repo = createD1PostRepository(env.DB);

    // Create a draft post (version 1)
    const post = await createPost(repo, humanActor, {
      siteId: "test-site",
      title: "Conflict Test",
      slug: "conflict-test",
      contentMarkdown: "# Original",
    });
    expect(post.status).toBe("draft");

    // Simulate editor loading: fetch current version (v1)
    const versions = await repo.listPostVersions("test-site", post.id);
    const loadedVersionNumber = versions[0]?.versionNumber ?? null;
    expect(loadedVersionNumber).toBe(1);

    // Concurrent edit: someone else updates the post (creates v2)
    const concurrentUpdate = await repo.updatePostWithHistory("test-site", post.id, {
      title: "Updated Title",
      contentMarkdown: "# Updated",
    }, humanActor, {
      changeSummary: "Concurrent edit",
      activityAction: "post.updated",
      activitySummary: "Updated post",
    });
    expect(concurrentUpdate?.versionNumber).toBe(2);

    // Verify version advanced
    const versionsAfterEdit = await repo.listPostVersions("test-site", post.id);
    expect(versionsAfterEdit[0]?.versionNumber).toBe(2);

    // Try to publish with the stale version number (v1)
    let caught: unknown;
    try {
      await publishPost(repo, humanActor, {
        siteId: "test-site",
        postId: post.id,
        expectedVersionNumber: loadedVersionNumber, // Still v1
        billingStatus: "active",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as Error).message).toMatch(/version/i);

    // Verify the post was NOT published
    const stillDraft = await repo.getPost("test-site", post.id);
    expect(stillDraft?.status).toBe("draft");
  });

  it("allows publish after refreshing version number following concurrent edit", async () => {
    const repo = createD1PostRepository(env.DB);

    // Create a draft post (version 1)
    const post = await createPost(repo, humanActor, {
      siteId: "test-site",
      title: "Refresh Test",
      slug: "refresh-test",
      contentMarkdown: "# Original",
    });

    // Simulate editor loading: fetch current version (v1)
    const versions = await repo.listPostVersions("test-site", post.id);
    const loadedVersionNumber = versions[0]?.versionNumber ?? null;
    expect(loadedVersionNumber).toBe(1);

    // Concurrent edit: someone else updates the post (creates v2)
    await repo.updatePostWithHistory("test-site", post.id, {
      title: "Updated Title",
      contentMarkdown: "# Updated",
    }, humanActor, {
      changeSummary: "Concurrent edit",
      activityAction: "post.updated",
      activitySummary: "Updated post",
    });

    // Simulate user refreshing the editor to see the new version
    const versionsAfterRefresh = await repo.listPostVersions("test-site", post.id);
    const refreshedVersionNumber = versionsAfterRefresh[0]?.versionNumber ?? null;
    expect(refreshedVersionNumber).toBe(2);

    // Publish with the refreshed version number (v2)
    const published = await publishPost(repo, humanActor, {
      siteId: "test-site",
      postId: post.id,
      expectedVersionNumber: refreshedVersionNumber,
      billingStatus: "active",
    });
    expect(published.status).toBe("published");
  });
});
