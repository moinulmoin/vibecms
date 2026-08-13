import { createPostInput, listPostsInput, updatePostInput } from "@vc/validators";
import { BillingRequiredError, ConflictError, NotFoundError } from "../errors";
import { hasActiveSubscription, requireScope } from "../policies";
import type { Actor, BillingStatus, Post, PostSummary, PostVersion, PostVersionSummary } from "../types";

export type PostMutationHistory = {
  changeSummary: string;
  activityAction: string;
  activitySummary: string;
};

export type PostRepository = {
  createPostWithHistory(input: Omit<Post, "createdAt" | "updatedAt" | "currentVersionNumber" | "publishedVersionNumber">, actor: Actor, history: PostMutationHistory): Promise<Post>;
  updatePostWithHistory(siteId: string, postId: string, patch: Partial<Post>, actor: Actor, history: PostMutationHistory, expectedVersionNumber: number): Promise<{ post: Post; versionNumber: number } | null>;
  getPost(siteId: string, postId: string): Promise<Post | null>;
  findPostBySlug(siteId: string, slug: string): Promise<Post | null>;
  listPosts(input: { siteId: string; status?: Post["status"]; search?: string; limit: number; offset: number }): Promise<PostSummary[]>;
  publishPostWithHistory(siteId: string, postId: string, expectedVersionNumber: number, actor: Actor, history: PostMutationHistory, options: { billingActive: boolean; freeLimit: number }): Promise<{ post: Post | null; capReached: boolean; versionConflict: false } | { post: null; capReached: boolean; versionConflict: true }>;
  listPostVersions(siteId: string, postId: string): Promise<PostVersionSummary[]>;
  getPostVersion(siteId: string, postId: string, versionNumber: number): Promise<PostVersion | null>;
};

// Draft-free model: a workspace may keep up to this many published posts without
// an active subscription, so new users can try the full publish loop.
const FREE_PUBLISHED_LIMIT = 5;

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
    canonicalUrl: data.canonicalUrl ?? null,
    seoTitle: data.seoTitle ?? null,
    seoDescription: data.seoDescription ?? null,
    status: "draft" as const,
    publishedAt: null,
    tags: data.tags ?? [],
    presentation: data.presentation ?? null,
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
    canonicalUrl: data.canonicalUrl === undefined ? before.canonicalUrl : data.canonicalUrl || null,
    seoTitle: data.seoTitle === undefined ? before.seoTitle : data.seoTitle || null,
    seoDescription: data.seoDescription === undefined ? before.seoDescription : data.seoDescription || null,
    tags: data.tags ?? before.tags,
    // presentation: undefined = preserve prior, null = reset to preset default, object = store intent
    presentation: data.presentation === undefined ? before.presentation : data.presentation,
  };
  const after = await repo.updatePostWithHistory(data.siteId, data.postId, patch, actor, {
    changeSummary: "Updated post",
    activityAction: "post.updated",
    activitySummary: `Updated ${patch.title}`,
  }, data.expectedVersionNumber);
  if (!after) throw new NotFoundError("Post not found");
  return after;
}

export async function publishPost(
  repo: PostRepository,
  actor: Actor,
  input: { siteId: string; postId: string; expectedVersionNumber: number; billingStatus: BillingStatus },
) {
  requireScope(actor, "posts:publish");
  const before = await repo.getPost(input.siteId, input.postId);
  if (!before) throw new NotFoundError("Post not found");
  // The version approval and free-publish cap are enforced in the repository's
  // atomic conditional write. A concurrent edit therefore cannot be published.
  const { post, capReached, versionConflict } = await repo.publishPostWithHistory(
    input.siteId,
    input.postId,
    input.expectedVersionNumber,
    actor,
    {
      changeSummary: "Published post",
      activityAction: "post.published",
      activitySummary: `Published ${before.title}`,
    },
    { billingActive: hasActiveSubscription(input.billingStatus), freeLimit: FREE_PUBLISHED_LIMIT },
  );
  if (versionConflict) {
    throw new ConflictError("Post changed since approval; review and approve the latest version before publishing");
  }
  if (capReached) throw new BillingRequiredError("Subscribe to publish more posts");
  if (!post) throw new NotFoundError("Post not found");
  return post;
}

export async function archivePost(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string }) {
  requireScope(actor, "posts:archive");
  const before = await repo.getPost(input.siteId, input.postId);
  if (!before) throw new NotFoundError("Post not found");
  // Archive is not client-versioned; pin against the tip observed in this command.
  const after = await repo.updatePostWithHistory(input.siteId, input.postId, { status: "archived" }, actor, {
    changeSummary: "Archived post",
    activityAction: "post.archived",
    activitySummary: `Archived ${before.title}`,
  }, before.currentVersionNumber);
  if (!after) throw new NotFoundError("Post not found");
  return after.post;
}

export async function getPost(repo: PostRepository, actor: Actor, siteId: string, postId: string) {
  requireScope(actor, "posts:read");
  const post = await repo.getPost(siteId, postId);
  if (!post) throw new NotFoundError("Post not found");
  return post;
}

export async function getPostBySlug(repo: PostRepository, actor: Actor, siteId: string, slug: string) {
  requireScope(actor, "posts:read");
  const post = await repo.findPostBySlug(siteId, slug);
  if (!post) throw new NotFoundError("Post not found");
  return post;
}

export function listPosts(repo: PostRepository, actor: Actor, input: unknown) {
  requireScope(actor, "posts:read");
  return repo.listPosts(listPostsInput.parse(input));
}

export async function listPostVersions(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string }) {
  requireScope(actor, "posts:read");
  return repo.listPostVersions(input.siteId, input.postId);
}

export async function getPostVersion(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string; versionNumber: number }) {
  requireScope(actor, "posts:read");
  const version = await repo.getPostVersion(input.siteId, input.postId, input.versionNumber);
  if (!version) throw new NotFoundError("Post version not found");
  return version;
}

export async function restorePostVersion(repo: PostRepository, actor: Actor, input: { siteId: string; postId: string; versionNumber: number; expectedVersionNumber: number }) {
  requireScope(actor, "posts:update");
  const target = await repo.getPostVersion(input.siteId, input.postId, input.versionNumber);
  if (!target) throw new NotFoundError("Post version not found");
  const patch: Partial<Post> = {
    title: target.title, slug: target.slug, excerpt: target.excerpt,
    contentMarkdown: target.contentMarkdown, coverAssetId: target.coverAssetId, canonicalUrl: target.canonicalUrl,
    seoTitle: target.seoTitle, seoDescription: target.seoDescription, tags: target.tags,
    presentation: target.presentation,
  };
  const after = await repo.updatePostWithHistory(input.siteId, input.postId, patch, actor, {
    changeSummary: `Restored to v${input.versionNumber}`,
    activityAction: "post.restored",
    activitySummary: `Restored "${target.title}" to v${input.versionNumber}`,
  }, input.expectedVersionNumber);
  if (!after) throw new NotFoundError("Post not found");
  return after.post;
}
