import { createPostInput, listPostsInput, updatePostInput } from "@vc/validators";
import { BillingRequiredError, NotFoundError } from "../errors";
import { requireScope } from "../policies";
import type { ActivityInput, Actor, BillingStatus, Post } from "../types";

export type PostRepository = {
  createPost(input: Omit<Post, "createdAt" | "updatedAt">, actor: Actor): Promise<Post>;
  updatePost(siteId: string, postId: string, patch: Partial<Post>, actor: Actor): Promise<Post | null>;
  getPost(siteId: string, postId: string): Promise<Post | null>;
  findPostBySlug(siteId: string, slug: string): Promise<Post | null>;
  listPosts(input: { siteId: string; status?: Post["status"]; search?: string }): Promise<Post[]>;
  createPostVersion(post: Post, actor: Actor, changeSummary: string): Promise<void>;
  createActivity(input: ActivityInput): Promise<void>;
};

function requirePublishBilling(status: BillingStatus) {
  if (status === "trialing" || status === "active") return;
  throw new BillingRequiredError("An active or trialing subscription is required to publish posts");
}

export async function createPost(repo: PostRepository, actor: Actor, input: unknown) {
  requireScope(actor, "posts:create");
  const data = createPostInput.parse(input);
  const post = await repo.createPost(
    {
      id: crypto.randomUUID(),
      siteId: data.siteId,
      title: data.title,
      slug: data.slug,
      excerpt: data.excerpt ?? null,
      contentMarkdown: data.contentMarkdown,
      coverAssetId: data.coverAssetId ?? null,
      status: "draft",
      publishedAt: null,
      tags: data.tags ?? [],
    },
    actor,
  );
  await repo.createPostVersion(post, actor, "Created post");
  await repo.createActivity({ siteId: post.siteId, actor, action: "post.created", entityType: "post", entityId: post.id, summary: `Created ${post.title}`, after: post });
  return post;
}

export async function updatePost(repo: PostRepository, actor: Actor, input: unknown) {
  requireScope(actor, "posts:update");
  const data = updatePostInput.parse(input);
  const before = await repo.getPost(data.siteId, data.postId);
  if (!before) throw new NotFoundError("Post not found");
  const after = await repo.updatePost(
    data.siteId,
    data.postId,
    {
      title: data.title ?? before.title,
      slug: data.slug ?? before.slug,
      excerpt: data.excerpt ?? before.excerpt,
      contentMarkdown: data.contentMarkdown ?? before.contentMarkdown,
      coverAssetId: data.coverAssetId === undefined ? before.coverAssetId : data.coverAssetId,
      tags: data.tags ?? before.tags,
    },
    actor,
  );
  if (!after) throw new NotFoundError("Post not found");
  await repo.createPostVersion(after, actor, "Updated post");
  await repo.createActivity({ siteId: after.siteId, actor, action: "post.updated", entityType: "post", entityId: after.id, summary: `Updated ${after.title}`, before, after });
  return after;
}

export async function publishPost(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string; billingStatus: BillingStatus }) {
  requireScope(actor, "posts:publish");
  requirePublishBilling(input.billingStatus);
  const before = await repo.getPost(input.siteId, input.postId);
  if (!before) throw new NotFoundError("Post not found");
  const after = await repo.updatePost(input.siteId, input.postId, { status: "published", publishedAt: Math.floor(Date.now() / 1000) }, actor);
  if (!after) throw new NotFoundError("Post not found");
  await repo.createPostVersion(after, actor, "Published post");
  await repo.createActivity({ siteId: after.siteId, actor, action: "post.published", entityType: "post", entityId: after.id, summary: `Published ${after.title}`, before, after });
  return after;
}

export async function archivePost(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string }) {
  requireScope(actor, "posts:archive");
  const before = await repo.getPost(input.siteId, input.postId);
  if (!before) throw new NotFoundError("Post not found");
  const after = await repo.updatePost(input.siteId, input.postId, { status: "archived" }, actor);
  if (!after) throw new NotFoundError("Post not found");
  await repo.createPostVersion(after, actor, "Archived post");
  await repo.createActivity({ siteId: after.siteId, actor, action: "post.archived", entityType: "post", entityId: after.id, summary: `Archived ${after.title}`, before, after });
  return after;
}

export async function getPost(repo: PostRepository, actor: Actor, siteId: string, postId: string) {
  requireScope(actor, "posts:read");
  const post = await repo.getPost(siteId, postId);
  if (!post) throw new NotFoundError("Post not found");
  return post;
}

export function listPosts(repo: PostRepository, actor: Actor, input: unknown) {
  requireScope(actor, "posts:read");
  return repo.listPosts(listPostsInput.parse(input));
}
