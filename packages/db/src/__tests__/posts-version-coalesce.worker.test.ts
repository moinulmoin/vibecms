/**
 * Autosave version coalescing under real miniflare D1.
 *
 * A human's rapid dashboard saves fold into the tip version while they keep
 * editing it; agents, other actors, the live version, restores, and an expired
 * window always get a fresh version. Run via `pnpm --filter @vc/db test`.
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
import { createD1PostRepository, createDataAccess } from "@vc/db";
import { publishPost, restorePostVersion, updatePost, type Actor } from "@vc/core";

const SITE = "site-pvc";
const HUMAN: Actor = { type: "human", id: "pvc-user", name: "PVC Human", role: "owner" };
const AGENT: Actor = {
  type: "api_key",
  id: "pvc-key",
  name: "PVC Agent",
  scopes: ["posts:read", "posts:create", "posts:update", "posts:publish"],
};

const da = createDataAccess(env.DB);
let postSeq = 0;

beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("ws-pvc", "PVC Workspace", "ws-pvc", 1_704_000_000, 1_704_000_000)
    .run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(SITE, "ws-pvc", "PVC Site", "pvc-site", 1_704_000_000, 1_704_000_000)
    .run();
});

async function newPost(actor: Actor) {
  postSeq += 1;
  return da.posts.createPostWithHistory(
    {
      id: `pvc-post-${postSeq}`,
      siteId: SITE,
      title: "Draft",
      slug: `pvc-draft-${postSeq}`,
      excerpt: null,
      contentMarkdown: "Hello",
      coverAssetId: null,
      canonicalUrl: null,
      seoTitle: null,
      seoDescription: null,
      status: "draft",
      publishedAt: null,
      tags: [],
      presentation: null,
    },
    actor,
    { changeSummary: "Created post", activityAction: "post.created", activitySummary: "Created Draft" },
  );
}

function edit(actor: Actor, postId: string, expectedVersionNumber: number, patch: Record<string, unknown>) {
  return updatePost(da.posts, actor, { siteId: SITE, postId, expectedVersionNumber, ...patch });
}

async function versions(postId: string) {
  const { results } = await env.DB.prepare(
    "SELECT version_number, change_summary, content_markdown, title FROM post_versions WHERE post_id = ? ORDER BY version_number",
  )
    .bind(postId)
    .all<{ version_number: number; change_summary: string; content_markdown: string; title: string }>();
  return results;
}

describe("autosave version coalescing", () => {
  it("folds a human's rapid edits into one version with a field summary", async () => {
    const post = await newPost(HUMAN);
    const first = await edit(HUMAN, post.id, 1, { contentMarkdown: "Hello world" });
    expect(first.versionNumber).toBe(2);
    const second = await edit(HUMAN, post.id, 2, { title: "Better title", contentMarkdown: "Hello world!" });
    expect(second.versionNumber).toBe(3);
    const third = await edit(HUMAN, post.id, 3, { tags: ["notes"] });
    expect(third.versionNumber).toBe(4);

    // (a) the folded edits share one row; (b) that row carries the bumped number.
    const rows = await versions(post.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.version_number)).toEqual([1, 4]);
    expect(rows[1]).toMatchObject({ change_summary: "Edited body, title, tags", title: "Better title", content_markdown: "Hello world!" });
    const current = await da.posts.getPost(SITE, post.id);
    expect(current).toMatchObject({ title: "Better title", tags: ["notes"], currentVersionNumber: 4 });
  });

  it("refuses publish and update against a version number that was folded away", async () => {
    const post = await newPost(HUMAN);
    await edit(HUMAN, post.id, 1, { contentMarkdown: "approved text" });
    // An agent got approval for v2, then the human kept typing (folds into v3).
    await edit(HUMAN, post.id, 2, { contentMarkdown: "edited after approval" });
    await expect(
      publishPost(da.posts, AGENT, { siteId: SITE, postId: post.id, expectedVersionNumber: 2, billingStatus: "active" }),
    ).rejects.toThrow(/changed|concurrent/i);
    await expect(edit(AGENT, post.id, 2, { contentMarkdown: "agent overwrite" })).rejects.toThrow(/changed|concurrent/i);
    expect(await da.posts.getPostVersion(SITE, post.id, 2)).toBeNull();
    const current = await da.posts.getPost(SITE, post.id);
    expect(current).toMatchObject({ status: "draft", currentVersionNumber: 3, contentMarkdown: "edited after approval" });
  });

  it("keeps cutting versions for agent writes", async () => {
    const post = await newPost(AGENT);
    await edit(AGENT, post.id, 1, { contentMarkdown: "a" });
    const again = await edit(AGENT, post.id, 2, { contentMarkdown: "b" });
    expect(again.versionNumber).toBe(3);
  });

  it("starts a new version when a different actor takes over", async () => {
    const post = await newPost(AGENT);
    await edit(AGENT, post.id, 1, { contentMarkdown: "agent draft" });
    const human = await edit(HUMAN, post.id, 2, { contentMarkdown: "human pass" });
    expect(human.versionNumber).toBe(3);
    const humanAgain = await edit(HUMAN, post.id, 3, { contentMarkdown: "human pass 2" });
    expect(humanAgain.versionNumber).toBe(4);
    expect(await versions(post.id)).toHaveLength(3);
  });

  it("never rewrites the live version", async () => {
    const post = await newPost(HUMAN);
    await edit(HUMAN, post.id, 1, { contentMarkdown: "ready" });
    await publishPost(da.posts, HUMAN, { siteId: SITE, postId: post.id, expectedVersionNumber: 2, billingStatus: "active" });
    const next = await edit(HUMAN, post.id, 2, { contentMarkdown: "after publish" });
    expect(next.versionNumber).toBe(3);
    const live = await da.posts.getPostVersion(SITE, post.id, 2);
    expect(live?.contentMarkdown).toBe("ready");
    const current = await da.posts.getPost(SITE, post.id);
    expect(current).toMatchObject({ publishedVersionNumber: 2, currentVersionNumber: 3 });
  });

  it("starts a new version after a restore and after the window expires", async () => {
    const post = await newPost(HUMAN);
    await edit(HUMAN, post.id, 1, { contentMarkdown: "one" });
    await restorePostVersion(da.posts, HUMAN, { siteId: SITE, postId: post.id, versionNumber: 1, expectedVersionNumber: 2 });
    const afterRestore = await edit(HUMAN, post.id, 3, { contentMarkdown: "two" });
    expect(afterRestore.versionNumber).toBe(4);

    await env.DB.prepare("UPDATE post_versions SET created_at = created_at - 3600 WHERE post_id = ? AND version_number = 4")
      .bind(post.id)
      .run();
    const stale = await edit(HUMAN, post.id, 4, { contentMarkdown: "three" });
    expect(stale.versionNumber).toBe(5);
  });

  it("a stale concurrent autosave cannot overwrite the post after another tab folded the tip", async () => {
    const post = await newPost(HUMAN);
    await edit(HUMAN, post.id, 1, { contentMarkdown: "v2 text" });
    // Tab B reads the post at v2, then stalls before its write batch.
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let reachedBatch!: () => void;
    const atBatch = new Promise<void>((resolve) => { reachedBatch = resolve; });
    const slowDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            reachedBatch();
            await released;
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const slowRepo = createD1PostRepository(slowDb);
    const stale = updatePost(slowRepo, HUMAN, { siteId: SITE, postId: post.id, expectedVersionNumber: 2, contentMarkdown: "tab B stale" });
    await atBatch;
    // Tab A folds its edit into the tip first (v2 -> v3).
    const tabA = await edit(HUMAN, post.id, 2, { contentMarkdown: "tab A wins" });
    expect(tabA.versionNumber).toBe(3);
    release();
    await expect(stale).rejects.toThrow(/concurrent|changed/i);

    const current = await da.posts.getPost(SITE, post.id);
    expect(current).toMatchObject({ contentMarkdown: "tab A wins", currentVersionNumber: 3 });
    const rows = await versions(post.id);
    expect(rows.map((row) => [row.version_number, row.content_markdown])).toEqual([[1, "Hello"], [3, "tab A wins"]]);
  });

  it("a coalesced activity event names every field edited since it opened", async () => {
    const post = await newPost(AGENT);
    await edit(AGENT, post.id, 1, { contentMarkdown: "agent body" });
    await edit(AGENT, post.id, 2, { title: "Agent title" });
    const { results } = await env.DB.prepare(
      "SELECT summary FROM activity_events WHERE entity_id = ? AND action = 'post.updated'",
    )
      .bind(post.id)
      .all<{ summary: string }>();
    expect(results).toEqual([{ summary: "Edited Agent title (title, body)" }]);
  });

  it("a human save with nothing changed does not cut a version past the live one", async () => {
    const post = await newPost(HUMAN);
    await edit(HUMAN, post.id, 1, { contentMarkdown: "ready" });
    await publishPost(da.posts, HUMAN, { siteId: SITE, postId: post.id, expectedVersionNumber: 2, billingStatus: "active" });
    const noop = await edit(HUMAN, post.id, 2, { title: "Draft", contentMarkdown: "ready" });
    expect(noop.versionNumber).toBe(2);
    expect(await versions(post.id)).toHaveLength(2);
    expect(await da.posts.getPost(SITE, post.id)).toMatchObject({ currentVersionNumber: 2, publishedVersionNumber: 2 });
    // Still version-checked.
    await expect(edit(HUMAN, post.id, 1, { contentMarkdown: "ready" })).rejects.toThrow(/concurrent|changed/i);
  });

  it("still rejects a stale expected version", async () => {
    const post = await newPost(HUMAN);
    await edit(HUMAN, post.id, 1, { contentMarkdown: "x" });
    await expect(edit(HUMAN, post.id, 1, { contentMarkdown: "y" })).rejects.toThrow(/concurrent|changed/i);
  });
});

describe("needs-review listing", () => {
  it("lists agent drafts and live posts with unpublished changes", async () => {
    const REVIEW_SITE = "site-pvr";
    await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(REVIEW_SITE, "ws-pvc", "PVR Site", "pvr-site", 1_704_000_000, 1_704_000_000)
      .run();
    const make = (id: string, actor: Actor, title: string) =>
      da.posts.createPostWithHistory(
        {
          id, siteId: REVIEW_SITE, title, slug: id, excerpt: null, contentMarkdown: "x", coverAssetId: null,
          canonicalUrl: null, seoTitle: null, seoDescription: null, status: "draft", publishedAt: null, tags: [], presentation: null,
        },
        actor,
        { changeSummary: "Created post", activityAction: "post.created", activitySummary: "Created" },
      );
    await make("pvr-agent-draft", AGENT, "Agent draft");
    await make("pvr-human-draft", HUMAN, "Human draft");
    await make("pvr-live-clean", HUMAN, "Live clean");
    await make("pvr-live-dirty", HUMAN, "Live 100% dirty");
    for (const id of ["pvr-live-clean", "pvr-live-dirty"]) {
      await publishPost(da.posts, HUMAN, { siteId: REVIEW_SITE, postId: id, expectedVersionNumber: 1, billingStatus: "active" });
    }
    await updatePost(da.posts, AGENT, { siteId: REVIEW_SITE, postId: "pvr-live-dirty", expectedVersionNumber: 1, contentMarkdown: "agent edit" });

    const review = await da.dashboard.listPostsForDashboard(REVIEW_SITE, { status: "review", limit: 10, offset: 0 });
    expect(review.map((r) => r.id).sort()).toEqual(["pvr-agent-draft", "pvr-live-dirty"]);
    expect(review.find((r) => r.id === "pvr-live-dirty")).toMatchObject({
      versionNumber: 2,
      publishedVersionNumber: 1,
      latestActorType: "api_key",
    });

    const agg = await da.dashboard.getDashboardAggregate(REVIEW_SITE);
    expect(agg.needsReviewCount).toBe(2);

    // LIKE wildcards in the search term are literal.
    const pct = await da.dashboard.listPostsForDashboard(REVIEW_SITE, { search: "100%", limit: 10, offset: 0 });
    expect(pct.map((r) => r.id)).toEqual(["pvr-live-dirty"]);

    const byTitle = await da.dashboard.listPostsForDashboard(REVIEW_SITE, { sort: "title", limit: 10, offset: 0 });
    expect(byTitle.map((r) => r.title)).toEqual(["Agent draft", "Human draft", "Live 100% dirty", "Live clean"]);
  });
});
