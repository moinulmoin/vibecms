/// <reference types="@cloudflare/vitest-pool-workers" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "vitest" {
  interface ProvidedContext { migrations: D1Migration[] }
}

import { beforeAll, describe, expect, inject, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { createD1PostRepository } from "@vc/db";
import { jsonAppError } from "./http-errors";
import { deleteArchivedPostForApp } from "./post-mutations";
import type { AppUserContext } from "./onboarding";

const siteId = "api-delete-site";
const actor = { type: "human" as const, id: "api-delete-editor", name: "Editor", role: "editor" as const };
const app = { siteId, actor } as AppUserContext;

beforeAll(async () => {
  await applyD1Migrations(env.DB, inject("migrations") as D1Migration[]);
  await env.DB.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('api-delete-ws', 'Site', 'api-delete-ws', 1, 1)").run();
  await env.DB.prepare("INSERT INTO sites (id, workspace_id, name, slug, created_at, updated_at) VALUES (?, 'api-delete-ws', 'Site', ?, 1, 1)")
    .bind(siteId, siteId).run();
});

describe("dashboard permanent deletion", () => {
  it("returns the existing 409 error envelope for a non-archived post", async () => {
    const post = await createD1PostRepository(env.DB).createPostWithHistory({
      id: "api-delete-draft", siteId, title: "Still a draft", slug: "still-a-draft",
      excerpt: null, contentMarkdown: "Body", coverAssetId: null, canonicalUrl: null,
      seoTitle: null, seoDescription: null, status: "draft", publishedAt: null,
      tags: [], presentation: null,
    }, actor, { changeSummary: "Created", activityAction: "post.created", activitySummary: "Created" });
    let response: Response | undefined;
    try {
      await deleteArchivedPostForApp(app, post.id);
    } catch (error) {
      response = jsonAppError(error);
    }
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ error: { code: "CONFLICT" } });
  });
});
