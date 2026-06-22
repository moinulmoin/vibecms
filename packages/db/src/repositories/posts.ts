import { ConflictError, type ActivityInput, type Actor, type Post, type PostRepository, type PostSummary, type PostVersion, type PostVersionSummary } from "@vc/core";

type PostRow = {
  id: string;
  site_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_markdown: string;
  cover_asset_id: string | null;
  canonical_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  status: string;
  published_at: number | null;
  tags_json: string;
  presentation_json: string | null;
  created_at: number;
  updated_at: number;
};


function now() {
  return Math.floor(Date.now() / 1000);
}

function actorId(actor: Actor) {
  return actor.id;
}

function actorName(actor: Actor) {
  return actor.name;
}

function normalizePostStatus(status: string): Post["status"] {
  return status === "published" || status === "archived" ? status : "draft";
}

function mapPost(row: PostRow): Post {
  return {
    id: row.id,
    siteId: row.site_id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    contentMarkdown: row.content_markdown,
    coverAssetId: row.cover_asset_id,
    canonicalUrl: row.canonical_url,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    status: normalizePostStatus(row.status),
    publishedAt: row.published_at,
    tags: JSON.parse(row.tags_json) as string[],
    presentation: row.presentation_json ? JSON.parse(row.presentation_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type PostSummaryRow = Omit<PostRow, "content_markdown" | "seo_title" | "seo_description" | "canonical_url">;

function mapPostSummary(row: PostSummaryRow): PostSummary {
  return {
    id: row.id,
    siteId: row.site_id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    coverAssetId: row.cover_asset_id,
    status: normalizePostStatus(row.status),
    publishedAt: row.published_at,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type PostVersionRow = {
  version_number: number; title: string; slug: string; status: string;
  change_summary: string | null; created_by_type: string; created_at: number; actor_name: string;
};
type PostVersionFullRow = PostVersionRow & {
  excerpt: string | null; content_markdown: string; cover_asset_id: string | null;
  seo_title: string | null; seo_description: string | null; tags_json: string;
  presentation_json: string | null;
};
function actorTypeOf(t: string): Actor["type"] {
  return t === "human" || t === "api_key" || t === "agent" ? t : "system";
}
function mapPostVersionSummary(row: PostVersionRow): PostVersionSummary {
  return {
    versionNumber: row.version_number, title: row.title, slug: row.slug,
    status: normalizePostStatus(row.status), changeSummary: row.change_summary,
    actorType: actorTypeOf(row.created_by_type), actorName: row.actor_name, createdAt: row.created_at,
  };
}
function mapPostVersion(row: PostVersionFullRow): PostVersion {
  return {
    ...mapPostVersionSummary(row),
    excerpt: row.excerpt, contentMarkdown: row.content_markdown, coverAssetId: row.cover_asset_id,
    seoTitle: row.seo_title, seoDescription: row.seo_description, tags: JSON.parse(row.tags_json) as string[],
    presentation: row.presentation_json ? JSON.parse(row.presentation_json) : null,
  };
}

function normalizeD1Error(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message.includes("idx_posts_site_slug_unique") || error.message.includes("posts.site_id, posts.slug")) {
    return new ConflictError("A post with this slug already exists");
  }
  if (error.message.includes("idx_post_versions_post_number") || error.message.includes("post_versions.post_id, post_versions.version_number")) {
    return new ConflictError("Post changed concurrently; retry the save");
  }
  return error;
}

export function createD1PostRepository(db: D1Database): PostRepository {
  const getPost = async (siteId: string, postId: string) => {
    const row = await db.prepare(
      `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, seo_title, seo_description, canonical_url, status, published_at,
        tags_json, presentation_json, created_at, updated_at
      FROM posts WHERE site_id = ? AND id = ? LIMIT 1`,
    ).bind(siteId, postId).first<PostRow>();
    return row ? mapPost(row) : null;
  };

  const postVersionStatement = (post: Post, actor: Actor, changeSummary: string, timestamp: number) => db.prepare(
    `INSERT INTO post_versions (
      id, post_id, site_id, version_number, title, slug, excerpt, content_markdown,
      cover_asset_id, seo_title, seo_description, canonical_url, status, tags_json, presentation_json, created_by_type, created_by_id, change_summary, created_at
    ) VALUES (?, ?, ?, COALESCE((SELECT MAX(version_number) FROM post_versions WHERE post_id = ?), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    post.id,
    post.siteId,
    post.id,
    post.title,
    post.slug,
    post.excerpt,
    post.contentMarkdown,
    post.coverAssetId,
    post.seoTitle,
    post.seoDescription,
    post.canonicalUrl,
    post.status,
    JSON.stringify(post.tags),
    post.presentation ? JSON.stringify(post.presentation) : null,
    actor.type,
    actorId(actor),
    changeSummary,
    timestamp,
  );

  const activityStatement = (input: ActivityInput, timestamp: number) => db.prepare(
    `INSERT INTO activity_events (
      id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id,
      summary, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.siteId,
    input.actor.type,
    actorId(input.actor),
    actorName(input.actor),
    input.action,
    input.entityType,
    input.entityId,
    input.summary,
    input.before ? JSON.stringify(input.before) : null,
    input.after ? JSON.stringify(input.after) : null,
    timestamp,
  );

  const runHistoryBatch = async (statements: D1PreparedStatement[]) => {
    try {
      // D1 batch statements are a SQL transaction: failure aborts and rolls
      // back the whole post/version/activity sequence.
      return await db.batch(statements);
    } catch (error) {
      throw normalizeD1Error(error);
    }
  };

  return {
    async createPostWithHistory(input, actor, history) {
      const timestamp = now();
      const post: Post = { ...input, createdAt: timestamp, updatedAt: timestamp };
      await runHistoryBatch([
        db.prepare(
          `INSERT INTO posts (
          id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, seo_title, seo_description, canonical_url, status, published_at,
            tags_json, presentation_json, created_by_type, created_by_id, updated_by_type, updated_by_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          post.id,
          post.siteId,
          post.title,
          post.slug,
          post.excerpt,
          post.contentMarkdown,
          post.coverAssetId,
          post.seoTitle,
          post.seoDescription,
          post.canonicalUrl,
          post.status,
          post.publishedAt,
          JSON.stringify(post.tags),
          post.presentation ? JSON.stringify(post.presentation) : null,
          actor.type,
          actorId(actor),
          actor.type,
          actorId(actor),
          timestamp,
          timestamp,
        ),
        postVersionStatement(post, actor, history.changeSummary, timestamp),
        activityStatement({ siteId: post.siteId, actor, action: history.activityAction, entityType: "post", entityId: post.id, summary: history.activitySummary, after: post }, timestamp),
      ]);
      return post;
    },

    async updatePostWithHistory(siteId, postId, patch, actor, history) {
      const before = await getPost(siteId, postId);
      if (!before) return null;
      const timestamp = now();
      const after: Post = { ...before, ...patch, updatedAt: timestamp };
      const [updateResult] = await runHistoryBatch([
        db.prepare(
          `UPDATE posts SET
          title = ?, slug = ?, excerpt = ?, content_markdown = ?, cover_asset_id = ?, seo_title = ?, seo_description = ?, canonical_url = ?, status = ?, published_at = ?,
            tags_json = ?, presentation_json = ?, updated_by_type = ?, updated_by_id = ?, updated_at = ?
          WHERE site_id = ? AND id = ?`,
        ).bind(
          after.title,
          after.slug,
          after.excerpt,
          after.contentMarkdown,
          after.coverAssetId,
          after.seoTitle,
          after.seoDescription,
          after.canonicalUrl,
          after.status,
          after.publishedAt,
          JSON.stringify(after.tags),
          after.presentation ? JSON.stringify(after.presentation) : null,
          actor.type,
          actorId(actor),
          timestamp,
          siteId,
          postId,
        ),
        postVersionStatement(after, actor, history.changeSummary, timestamp),
        activityStatement({ siteId: after.siteId, actor, action: history.activityAction, entityType: "post", entityId: after.id, summary: history.activitySummary, before, after }, timestamp),
      ]);
      return updateResult.meta.changes === 0 ? null : after;
    },

    getPost,

    async findPostBySlug(siteId, slug) {
      const row = await db.prepare(
        `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, seo_title, seo_description, canonical_url, status, published_at,
          tags_json, presentation_json, created_at, updated_at
        FROM posts WHERE site_id = ? AND slug = ? LIMIT 1`,
      ).bind(siteId, slug).first<PostRow>();
      return row ? mapPost(row) : null;
    },

    async listPosts(input) {
      const search = input.search ? `%${input.search}%` : null;
      const result = input.status
        ? search
          ? await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts
              WHERE site_id = ? AND status = ? AND (title LIKE ? OR slug LIKE ? OR excerpt LIKE ?)
              ORDER BY updated_at DESC
              LIMIT ? OFFSET ?`,
            ).bind(input.siteId, input.status, search, search, search, input.limit, input.offset).all<PostSummaryRow>()
          : await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts WHERE site_id = ? AND status = ? ORDER BY updated_at DESC
              LIMIT ? OFFSET ?`,
            ).bind(input.siteId, input.status, input.limit, input.offset).all<PostSummaryRow>()
        : search
          ? await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts
              WHERE site_id = ? AND (title LIKE ? OR slug LIKE ? OR excerpt LIKE ?)
              ORDER BY updated_at DESC
              LIMIT ? OFFSET ?`,
            ).bind(input.siteId, search, search, search, input.limit, input.offset).all<PostSummaryRow>()
          : await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts WHERE site_id = ? ORDER BY updated_at DESC
              LIMIT ? OFFSET ?`,
            ).bind(input.siteId, input.limit, input.offset).all<PostSummaryRow>();
      return result.results.map(mapPostSummary);
    },

    async publishPostWithHistory(siteId, postId, actor, history, options) {
      const before = await getPost(siteId, postId);
      if (!before) return { post: null, capReached: false };
      if (before.status === "published") return { post: before, capReached: false };
      const timestamp = now();
      // Atomic free-publish cap: the COUNT subquery is evaluated inside this write
      // and D1 serializes writes, so concurrent publishes cannot both pass the guard.
      const [claim] = await runHistoryBatch([
        db.prepare(
          `UPDATE posts SET status = 'published', published_at = ?, updated_at = ?, updated_by_type = ?, updated_by_id = ?
           WHERE site_id = ? AND id = ? AND status != 'published'
             AND (? = 1 OR (SELECT COUNT(*) FROM posts WHERE site_id = ? AND status = 'published') < ?)`,
        ).bind(timestamp, timestamp, actor.type, actorId(actor), siteId, postId, options.billingActive ? 1 : 0, siteId, options.freeLimit),
      ]);
      if (claim.meta.changes === 0) return { post: null, capReached: true };
      const after: Post = { ...before, status: "published", publishedAt: timestamp, updatedAt: timestamp };
      await runHistoryBatch([
        postVersionStatement(after, actor, history.changeSummary, timestamp),
        activityStatement({ siteId: after.siteId, actor, action: history.activityAction, entityType: "post", entityId: after.id, summary: history.activitySummary, before, after }, timestamp),
      ]);
      return { post: after, capReached: false };
    },

    async listPostVersions(siteId, postId) {
      const result = await db.prepare(
        `SELECT pv.version_number, pv.title, pv.slug, pv.status, pv.change_summary, pv.created_by_type, pv.created_at,
          COALESCE((SELECT name FROM user WHERE id = pv.created_by_id),
                   (SELECT actor_name FROM api_keys WHERE id = pv.created_by_id),
                   pv.created_by_id) AS actor_name
        FROM post_versions pv
        WHERE pv.site_id = ? AND pv.post_id = ?
        ORDER BY pv.version_number DESC`,
      ).bind(siteId, postId).all<PostVersionRow>();
      return result.results.map(mapPostVersionSummary);
    },

    async getPostVersion(siteId, postId, versionNumber) {
      const row = await db.prepare(
        `SELECT pv.version_number, pv.title, pv.slug, pv.status, pv.change_summary, pv.created_by_type, pv.created_at,
          pv.excerpt, pv.content_markdown, pv.cover_asset_id, pv.seo_title, pv.seo_description, pv.tags_json, pv.presentation_json,
          COALESCE((SELECT name FROM user WHERE id = pv.created_by_id),
                   (SELECT actor_name FROM api_keys WHERE id = pv.created_by_id),
                   pv.created_by_id) AS actor_name
        FROM post_versions pv
        WHERE pv.site_id = ? AND pv.post_id = ? AND pv.version_number = ? LIMIT 1`,
      ).bind(siteId, postId, versionNumber).first<PostVersionFullRow>();
      return row ? mapPostVersion(row) : null;
    },
  };
}
