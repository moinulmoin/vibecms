import { describe, expect, it, vi } from "vitest";
import {
  resolvePublishedVersionSlug,
  scheduleLiveArticlePurges,
  uniqueArticlePurgeSlugs,
} from "./post-live-purge";

vi.mock("@/server/purge-scheduler", () => ({
  scheduleArticlePurge: vi.fn(),
}));

import { scheduleArticlePurge } from "@/server/purge-scheduler";
import { deleteArchivedPostForApp } from "./post-mutations";
import type { AppUserContext } from "./onboarding";

describe("uniqueArticlePurgeSlugs", () => {
  it("refuses permanent deletion for a viewer and an agent", async () => {
    const app = { siteId: "site", actor: { type: "human", role: "viewer", id: "viewer", name: "Viewer" } } as AppUserContext;
    await expect(deleteArchivedPostForApp(app, "post")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const agent = { siteId: "site", actor: { type: "api_key", id: "key", name: "Agent", scopes: ["posts:archive"] } } as AppUserContext;
    await expect(deleteArchivedPostForApp(agent, "post")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("dedupes equal old/new live slugs", () => {
    expect(uniqueArticlePurgeSlugs("same", "same")).toEqual(["same"]);
  });

  it("keeps both when draft slug diverged from pinned live slug", () => {
    expect(uniqueArticlePurgeSlugs("old-live", "new-draft")).toEqual(["old-live", "new-draft"]);
  });

  it("drops null/undefined and preserves first-seen order", () => {
    expect(uniqueArticlePurgeSlugs(null, "only", undefined, "only", "extra")).toEqual([
      "only",
      "extra",
    ]);
  });
});

describe("resolvePublishedVersionSlug", () => {
  it("returns null when no published version is pinned", async () => {
    const repo = {
      getPost: vi.fn(async () => ({ publishedVersionNumber: null })),
      getPostVersion: vi.fn(),
    };
    await expect(resolvePublishedVersionSlug(repo, "site", "post")).resolves.toBeNull();
    expect(repo.getPostVersion).not.toHaveBeenCalled();
  });

  it("returns the pinned published-version slug", async () => {
    const repo = {
      getPost: vi.fn(async () => ({ publishedVersionNumber: 2 })),
      getPostVersion: vi.fn(async () => ({ slug: "pinned-live" })),
    };
    await expect(resolvePublishedVersionSlug(repo, "site", "post")).resolves.toBe("pinned-live");
    expect(repo.getPostVersion).toHaveBeenCalledWith("site", "post", 2);
  });
});

describe("scheduleLiveArticlePurges", () => {
  it("schedules one purge per distinct slug including the prior live slug", () => {
    vi.mocked(scheduleArticlePurge).mockClear();
    scheduleLiveArticlePurges("site-1", "demo", "old-live", "new-live", "new-live");
    expect(scheduleArticlePurge).toHaveBeenCalledTimes(2);
    expect(scheduleArticlePurge).toHaveBeenNthCalledWith(1, "site-1", "demo", "old-live");
    expect(scheduleArticlePurge).toHaveBeenNthCalledWith(2, "site-1", "demo", "new-live");
  });
});
