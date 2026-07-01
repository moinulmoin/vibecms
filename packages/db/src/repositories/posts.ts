import { and, desc, eq, like, ne, or, sql, type SQL } from "drizzle-orm";
import { ConflictError, type ActivityInput, type Actor, type Post, type PostRepository, type PostSummary, type PostVersion, type PostVersionSummary } from "@vc/core";
import { createDbClient } from "../client";
import { activityEvents, apiKeys, postVersions, posts, user, type PostRow } from "../schema";

function now() {
  return Math.floor(Date.now() / 1000);
}

function normalizePostStatus(status: string): Post["status"] {
  return status === "published" || status === "archived" ? status : "draft";
}

function actorTypeOf(t: string): Actor["type"] {
  return t === "human" || t === "api_key" || t === "agent" ? t : "system";
}

// Drizzle returns camelCase fields (the schema maps snake_case columns); project to the core domain model.
function mapPost(row: PostRow): Post {
  return {
    id: row.id,
    siteId: row.siteId,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    contentMarkdown: row.contentMarkdown,
    coverAssetId: row.coverAssetId,
    canonicalUrl: row.canonicalUrl,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    status: normalizePostStatus(row.status),
    publishedAt: row.publishedAt,
    tags: JSON.parse(row.tagsJson) as string[],
    presentation: row.presentationJson ? JSON.parse(row.presentationJson) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Summary read model: content/seo/canonical/presentation columns are intentionally omitted.
type PostSummaryProjection = {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverAssetId: string | null;
  status: string;
  publishedAt: number | null;
  tagsJson: string;
  createdAt: number;
  updatedAt: number;
};

const postSummaryFields = {
  id: posts.id,
  siteId: posts.siteId,
  title: posts.title,
  slug: posts.slug,
  excerpt: posts.excerpt,
  coverAssetId: posts.coverAssetId,
  status: posts.status,
  publishedAt: posts.publishedAt,
  tagsJson: posts.tagsJson,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

function mapPostSummary(row: PostSummaryProjection): PostSummary {
  return {
    id: row.id,
    siteId: row.siteId,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    coverAssetId: row.coverAssetId,
    status: normalizePostStatus(row.status),
    publishedAt: row.publishedAt,
    tags: JSON.parse(row.tagsJson) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type PostVersionSummaryProjection = {
  versionNumber: number;
  title: string;
  slug: string;
  status: string;
  changeSummary: string | null;
  createdByType: string;
  createdAt: number;
  actorName: string;
};

function mapPostVersionSummary(row: PostVersionSummaryProjection): PostVersionSummary {
  return {
    versionNumber: row.versionNumber,
    title: row.title,
    slug: row.slug,
    status: normalizePostStatus(row.status),
    changeSummary: row.changeSummary,
    actorType: actorTypeOf(row.createdByType),
    actorName: row.actorName,
    createdAt: row.createdAt,
  };
}

type PostVersionFullProjection = PostVersionSummaryProjection & {
  excerpt: string | null;
  contentMarkdown: string;
  coverAssetId: string | null;
  canonicalUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  tagsJson: string;
  presentationJson: string | null;
};

function mapPostVersion(row: PostVersionFullProjection): PostVersion {
  return {
    ...mapPostVersionSummary(row),
    excerpt: row.excerpt,
    contentMarkdown: row.contentMarkdown,
    coverAssetId: row.coverAssetId,
    canonicalUrl: row.canonicalUrl,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    tags: JSON.parse(row.tagsJson) as string[],
    presentation: row.presentationJson ? JSON.parse(row.presentationJson) : null,
  };
}

// Drizzle wraps D1 errors; the UNIQUE-constraint text lives on the cause chain, not .message.
function mapPostError(error: unknown): unknown {
  const chain: string[] = [];
  let cur: unknown = error;
  while (cur instanceof Error) {
    chain.push(cur.message);
    cur = cur.cause;
  }
  const text = chain.join("\n");
  if (text.includes("idx_posts_site_slug_unique") || text.includes("posts.site_id, posts.slug")) {
    return new ConflictError("A post with this slug already exists");
  }
  if (text.includes("idx_post_versions_post_number") || text.includes("post_versions.post_id, post_versions.version_number")) {
    return new ConflictError("Post changed concurrently; retry the save");
  }
  return error;
}

export function createD1PostRepository(db: D1Database): PostRepository {
  const client = createDbClient(db);

  const getPost = async (siteId: string, postId: string) => {
    const rows = await client
      .select()
      .from(posts)
      .where(and(eq(posts.siteId, siteId), eq(posts.id, postId)))
      .limit(1);
    return rows[0] ? mapPost(rows[0]) : null;
  };

  // Version number = max(existing) + 1, computed inside the insert via a correlated subquery.
  const postVersionInsert = (post: Post, actor: Actor, changeSummary: string, timestamp: number) =>
    client.insert(postVersions).values({
      id: crypto.randomUUID(),
      postId: post.id,
      siteId: post.siteId,
      versionNumber: sql<number>`coalesce((select max(${postVersions.versionNumber}) from ${postVersions} where ${postVersions.postId} = ${post.id}), 0) + 1`,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      contentMarkdown: post.contentMarkdown,
      coverAssetId: post.coverAssetId,
      status: post.status,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      canonicalUrl: post.canonicalUrl,
      tagsJson: JSON.stringify(post.tags),
      presentationJson: post.presentation ? JSON.stringify(post.presentation) : null,
      createdByType: actor.type,
      createdById: actor.id,
      changeSummary,
      createdAt: timestamp,
    });

  const activityInsert = (input: ActivityInput, timestamp: number) =>
    client.insert(activityEvents).values({
      id: crypto.randomUUID(),
      siteId: input.siteId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorName: input.actor.name,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      beforeJson: input.before ? JSON.stringify(input.before) : null,
      afterJson: input.after ? JSON.stringify(input.after) : null,
      createdAt: timestamp,
    });

  return {
    async createPostWithHistory(input, actor, history) {
      const timestamp = now();
      const post: Post = { ...input, createdAt: timestamp, updatedAt: timestamp };
      // D1 batch is one transaction: post, version snapshot, and activity land together or not at all.
      try {
        await client.batch([
          client.insert(posts).values({
            id: post.id,
            siteId: post.siteId,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            contentMarkdown: post.contentMarkdown,
            coverAssetId: post.coverAssetId,
            status: post.status,
            publishedAt: post.publishedAt,
            seoTitle: post.seoTitle,
            seoDescription: post.seoDescription,
            canonicalUrl: post.canonicalUrl,
            tagsJson: JSON.stringify(post.tags),
            presentationJson: post.presentation ? JSON.stringify(post.presentation) : null,
            createdByType: actor.type,
            createdById: actor.id,
            updatedByType: actor.type,
            updatedById: actor.id,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
          postVersionInsert(post, actor, history.changeSummary, timestamp),
          activityInsert({ siteId: post.siteId, actor, action: history.activityAction, entityType: "post", entityId: post.id, summary: history.activitySummary, after: post }, timestamp),
        ]);
      } catch (error) {
        throw mapPostError(error);
      }
      return post;
    },

    async updatePostWithHistory(siteId, postId, patch, actor, history) {
      const before = await getPost(siteId, postId);
      if (!before) return null;
      const timestamp = now();
      const after: Post = { ...before, ...patch, updatedAt: timestamp };
      try {
        const [updateResult] = await client.batch([
          client
            .update(posts)
            .set({
              title: after.title,
              slug: after.slug,
              excerpt: after.excerpt,
              contentMarkdown: after.contentMarkdown,
              coverAssetId: after.coverAssetId,
              status: after.status,
              publishedAt: after.publishedAt,
              seoTitle: after.seoTitle,
              seoDescription: after.seoDescription,
              canonicalUrl: after.canonicalUrl,
              tagsJson: JSON.stringify(after.tags),
              presentationJson: after.presentation ? JSON.stringify(after.presentation) : null,
              updatedByType: actor.type,
              updatedById: actor.id,
              updatedAt: timestamp,
            })
            .where(and(eq(posts.siteId, siteId), eq(posts.id, postId))),
          postVersionInsert(after, actor, history.changeSummary, timestamp),
          activityInsert({ siteId: after.siteId, actor, action: history.activityAction, entityType: "post", entityId: after.id, summary: history.activitySummary, before, after }, timestamp),
        ]);
        return (updateResult.meta.changes ?? 0) === 0 ? null : after;
      } catch (error) {
        throw mapPostError(error);
      }
    },

    getPost,

    async findPostBySlug(siteId, slug) {
      const rows = await client
        .select()
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.slug, slug)))
        .limit(1);
      return rows[0] ? mapPost(rows[0]) : null;
    },

    async listPosts(input) {
      // Admin search uses unescaped %term% LIKE across title/slug/excerpt, matching prior behavior.
      const search = input.search ? `%${input.search}%` : null;
      const conditions: (SQL | undefined)[] = [eq(posts.siteId, input.siteId)];
      if (input.status) conditions.push(eq(posts.status, input.status));
      if (search) conditions.push(or(like(posts.title, search), like(posts.slug, search), like(posts.excerpt, search)));
      const rows = await client
        .select(postSummaryFields)
        .from(posts)
        .where(and(...conditions))
        .orderBy(desc(posts.updatedAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows.map((row) => mapPostSummary(row));
    },

    async publishPostWithHistory(siteId, postId, actor, history, options) {
      const before = await getPost(siteId, postId);
      if (!before) return { post: null, capReached: false };
      if (before.status === "published") return { post: before, capReached: false };
      const timestamp = now();
      // One guarded UPDATE: the correlated COUNT runs inside the write, so concurrent publishes
      // cannot both slip past the free-publish cap. meta.changes decides cap reached vs. applied.
      const claim = await client
        .update(posts)
        .set({
          status: "published",
          publishedAt: timestamp,
          updatedAt: timestamp,
          updatedByType: actor.type,
          updatedById: actor.id,
        })
        .where(
          and(
            eq(posts.siteId, siteId),
            eq(posts.id, postId),
            ne(posts.status, "published"),
            or(
              sql`${options.billingActive ? 1 : 0} = 1`,
              sql`(select count(*) from ${posts} where ${posts.siteId} = ${siteId} and ${posts.status} = 'published') < ${options.freeLimit}`,
            ),
          ),
        )
        .run();
      if ((claim.meta.changes ?? 0) === 0) return { post: null, capReached: true };
      const after: Post = { ...before, status: "published", publishedAt: timestamp, updatedAt: timestamp };
      // Two-step history (matching prior behavior): the version + activity snapshot only when the
      // claim above actually applied. This second batch is NOT atomic with the guarded UPDATE.
      try {
        await client.batch([
          postVersionInsert(after, actor, history.changeSummary, timestamp),
          activityInsert({ siteId: after.siteId, actor, action: history.activityAction, entityType: "post", entityId: after.id, summary: history.activitySummary, before, after }, timestamp),
        ]);
      } catch (error) {
        throw mapPostError(error);
      }
      return { post: after, capReached: false };
    },

    async listPostVersions(siteId, postId) {
      // actorName = COALESCE(user.name, api_keys.actor_name, created_by_id) resolved via left joins.
      const rows = await client
        .select({
          versionNumber: postVersions.versionNumber,
          title: postVersions.title,
          slug: postVersions.slug,
          status: postVersions.status,
          changeSummary: postVersions.changeSummary,
          createdByType: postVersions.createdByType,
          createdAt: postVersions.createdAt,
          actorName: sql<string>`coalesce(${user.name}, ${apiKeys.actorName}, ${postVersions.createdById})`,
        })
        .from(postVersions)
        .leftJoin(user, eq(user.id, postVersions.createdById))
        .leftJoin(apiKeys, eq(apiKeys.id, postVersions.createdById))
        .where(and(eq(postVersions.siteId, siteId), eq(postVersions.postId, postId)))
        .orderBy(desc(postVersions.versionNumber));
      return rows.map((row) => mapPostVersionSummary(row));
    },

    async getPostVersion(siteId, postId, versionNumber) {
      const rows = await client
        .select({
          versionNumber: postVersions.versionNumber,
          title: postVersions.title,
          slug: postVersions.slug,
          status: postVersions.status,
          changeSummary: postVersions.changeSummary,
          createdByType: postVersions.createdByType,
          createdAt: postVersions.createdAt,
          excerpt: postVersions.excerpt,
          contentMarkdown: postVersions.contentMarkdown,
          coverAssetId: postVersions.coverAssetId,
          canonicalUrl: postVersions.canonicalUrl,
          seoTitle: postVersions.seoTitle,
          seoDescription: postVersions.seoDescription,
          tagsJson: postVersions.tagsJson,
          presentationJson: postVersions.presentationJson,
          actorName: sql<string>`coalesce(${user.name}, ${apiKeys.actorName}, ${postVersions.createdById})`,
        })
        .from(postVersions)
        .leftJoin(user, eq(user.id, postVersions.createdById))
        .leftJoin(apiKeys, eq(apiKeys.id, postVersions.createdById))
        .where(and(eq(postVersions.siteId, siteId), eq(postVersions.postId, postId), eq(postVersions.versionNumber, versionNumber)))
        .limit(1);
      return rows[0] ? mapPostVersion(rows[0]) : null;
    },
  };
}
