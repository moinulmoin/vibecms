import { describe, expect, it } from "vitest";
import { archivePost } from "../../core/src/commands/posts";

// Lives here because core and config have no test runner of their own.
describe("archive approval binding", () => {
  it("rejects an intervening edit before writing and accepts the approved tip", async () => {
    const actor = { type: "human", id: "owner", name: "Owner", role: "owner" } as const;
    const post = { id: "post", siteId: "site", title: "Draft", currentVersionNumber: 2, status: "published" };
    let writes = 0;
    const repo = {
      getPost: async () => post,
      updatePostWithHistory: async () => {
        writes++;
        return { post: { ...post, status: "archived" }, versionNumber: 3 };
      },
    } as unknown as Parameters<typeof archivePost>[0];
    await expect(archivePost(repo, actor as never, { siteId: "site", postId: "post", expectedVersionNumber: 1 })).rejects.toThrow(
      "Post changed since archive approval. Re-read the post and confirm the current version before archiving.",
    );
    expect(writes).toBe(0);
    expect((await archivePost(repo, actor as never, { siteId: "site", postId: "post", expectedVersionNumber: 2 })).status).toBe("archived");
    expect(writes).toBe(1);
  });
});
