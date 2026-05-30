import type { ActivityInput, Actor, Post, PostRepository } from "@vc/core";

type PostRow = {
  id: string;
  site_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_markdown: string;
  cover_asset_id: string | null;
  status: Post["status"];
  published_at: number | null;
  tags_json: string;
  created_at: number;
  updated_at: number;
};

type VersionRow = { next_version: number | null };

function now() {
  return Math.floor(Date.now() / 1000);
}

function actorId(actor: Actor) {
  return actor.id;
}

function actorName(actor: Actor) {
  return actor.name;
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
    status: row.status,
    publishedAt: row.published_at,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createD1PostRepository(db: D1Database): PostRepository {
  return {
    async createPost(input, actor) {
      const timestamp = now();
      await db.prepare(
        `INSERT INTO posts (
          id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
          tags_json, created_by_type, created_by_id, updated_by_type, updated_by_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.id,
        input.siteId,
        input.title,
        input.slug,
        input.excerpt,
        input.contentMarkdown,
        input.coverAssetId,
        input.status,
        input.publishedAt,
        JSON.stringify(input.tags),
        actor.type,
        actorId(actor),
        actor.type,
        actorId(actor),
        timestamp,
        timestamp,
      ).run();
      const post = await this.getPost(input.siteId, input.id);
      if (!post) throw new Error("Post insert failed");
      return post;
    },

    async updatePost(siteId, postId, patch, actor) {
      const before = await this.getPost(siteId, postId);
      if (!before) return null;
      const next = { ...before, ...patch, updatedAt: now() };
      await db.prepare(
        `UPDATE posts SET
          title = ?, slug = ?, excerpt = ?, content_markdown = ?, cover_asset_id = ?, status = ?, published_at = ?,
          tags_json = ?, updated_by_type = ?, updated_by_id = ?, updated_at = ?
        WHERE site_id = ? AND id = ?`,
      ).bind(
        next.title,
        next.slug,
        next.excerpt,
        next.contentMarkdown,
        next.coverAssetId,
        next.status,
        next.publishedAt,
        JSON.stringify(next.tags),
        actor.type,
        actorId(actor),
        next.updatedAt,
        siteId,
        postId,
      ).run();
      return this.getPost(siteId, postId);
    },

    async getPost(siteId, postId) {
      const row = await db.prepare(
        `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
          tags_json, created_at, updated_at
        FROM posts WHERE site_id = ? AND id = ? LIMIT 1`,
      ).bind(siteId, postId).first<PostRow>();
      return row ? mapPost(row) : null;
    },

    async findPostBySlug(siteId, slug) {
      const row = await db.prepare(
        `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
          tags_json, created_at, updated_at
        FROM posts WHERE site_id = ? AND slug = ? LIMIT 1`,
      ).bind(siteId, slug).first<PostRow>();
      return row ? mapPost(row) : null;
    },

    async listPosts(input) {
      const search = input.search ? `%${input.search}%` : null;
      const result = input.status
        ? search
          ? await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts
              WHERE site_id = ? AND status = ? AND (title LIKE ? OR slug LIKE ? OR excerpt LIKE ?)
              ORDER BY updated_at DESC`,
            ).bind(input.siteId, input.status, search, search, search).all<PostRow>()
          : await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts WHERE site_id = ? AND status = ? ORDER BY updated_at DESC`,
            ).bind(input.siteId, input.status).all<PostRow>()
        : search
          ? await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts
              WHERE site_id = ? AND (title LIKE ? OR slug LIKE ? OR excerpt LIKE ?)
              ORDER BY updated_at DESC`,
            ).bind(input.siteId, search, search, search).all<PostRow>()
          : await db.prepare(
              `SELECT id, site_id, title, slug, excerpt, content_markdown, cover_asset_id, status, published_at,
                tags_json, created_at, updated_at
              FROM posts WHERE site_id = ? ORDER BY updated_at DESC`,
            ).bind(input.siteId).all<PostRow>();
      return result.results.map(mapPost);
    },

    async createPostVersion(post, actor, changeSummary) {
      const version = await db.prepare(
        "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM post_versions WHERE post_id = ?",
      ).bind(post.id).first<VersionRow>();
      await db.prepare(
        `INSERT INTO post_versions (
          id, post_id, site_id, version_number, title, slug, excerpt, content_markdown,
          cover_asset_id, status, tags_json, created_by_type, created_by_id, change_summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        post.id,
        post.siteId,
        version?.next_version ?? 1,
        post.title,
        post.slug,
        post.excerpt,
        post.contentMarkdown,
        post.coverAssetId,
        post.status,
        JSON.stringify(post.tags),
        actor.type,
        actorId(actor),
        changeSummary,
        now(),
      ).run();
    },

    async createActivity(input: ActivityInput) {
      await db.prepare(
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
        now(),
      ).run();
    },
  };
}
