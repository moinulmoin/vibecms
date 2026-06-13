import { createPostInput, listPostsInput, updatePostInput } from "@vc/validators";
import { BillingRequiredError, NotFoundError } from "../errors";
import { requireScope } from "../policies";
import type { Actor, BillingStatus, Post, PostSummary } from "../types";

export type PostMutationHistory = {
  changeSummary: string;
  activityAction: string;
  activitySummary: string;
};

export type PostRepository = {
  createPostWithHistory(input: Omit<Post, "createdAt" | "updatedAt">, actor: Actor, history: PostMutationHistory): Promise<Post>;
  updatePostWithHistory(siteId: string, postId: string, patch: Partial<Post>, actor: Actor, history: PostMutationHistory): Promise<Post | null>;
  getPost(siteId: string, postId: string): Promise<Post | null>;
  findPostBySlug(siteId: string, slug: string): Promise<Post | null>;
  listPosts(input: { siteId: string; status?: Post["status"]; search?: string; limit: number; offset: number }): Promise<PostSummary[]>;
};

function requirePublishBilling(status: BillingStatus) {
  if (status === "active") return;
  throw new BillingRequiredError("An active subscription is required to publish posts");
}

export async function createPost(repo: PostRepository, actor: Actor, input: unknown) {
  requireScope(actor, "posts:create");
  const data = createPostInput.parse(input);
  const postInput = {
    id: crypto.randomUUID(),
    siteId: data.siteId,
    title: data.title,
    slug: data.slug,
    excerpt: data.excerpt ?? null,
    contentMarkdown: data.contentMarkdown,
    coverAssetId: data.coverAssetId ?? null,
    status: "draft" as const,
    publishedAt: null,
    tags: data.tags ?? [],
  };
  return repo.createPostWithHistory(postInput, actor, {
    changeSummary: "Created post",
    activityAction: "post.created",
    activitySummary: `Created ${postInput.title}`,
  });
}

export async function updatePost(repo: PostRepository, actor: Actor, input: unknown) {
  requireScope(actor, "posts:update");
  const data = updatePostInput.parse(input);
  const before = await repo.getPost(data.siteId, data.postId);
  if (!before) throw new NotFoundError("Post not found");
  const patch = {
    title: data.title ?? before.title,
    slug: data.slug ?? before.slug,
    excerpt: data.excerpt ?? before.excerpt,
    contentMarkdown: data.contentMarkdown ?? before.contentMarkdown,
    coverAssetId: data.coverAssetId === undefined ? before.coverAssetId : data.coverAssetId,
    tags: data.tags ?? before.tags,
  };
  const after = await repo.updatePostWithHistory(data.siteId, data.postId, patch, actor, {
    changeSummary: "Updated post",
    activityAction: "post.updated",
    activitySummary: `Updated ${patch.title}`,
  });
  if (!after) throw new NotFoundError("Post not found");
  return after;
}

export async function publishPost(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string; billingStatus: BillingStatus }) {
  requireScope(actor, "posts:publish");
  requirePublishBilling(input.billingStatus);
  const before = await repo.getPost(input.siteId, input.postId);
  if (!before) throw new NotFoundError("Post not found");
  const after = await repo.updatePostWithHistory(input.siteId, input.postId, { status: "published", publishedAt: Math.floor(Date.now() / 1000) }, actor, {
    changeSummary: "Published post",
    activityAction: "post.published",
    activitySummary: `Published ${before.title}`,
  });
  if (!after) throw new NotFoundError("Post not found");
  return after;
}

export async function archivePost(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string }) {
  requireScope(actor, "posts:archive");
  const before = await repo.getPost(input.siteId, input.postId);
  if (!before) throw new NotFoundError("Post not found");
  const after = await repo.updatePostWithHistory(input.siteId, input.postId, { status: "archived" }, actor, {
    changeSummary: "Archived post",
    activityAction: "post.archived",
    activitySummary: `Archived ${before.title}`,
  });
  if (!after) throw new NotFoundError("Post not found");
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
