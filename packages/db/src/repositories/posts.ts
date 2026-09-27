import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { changedPostFields, ConflictError, firstParagraph, type Actor, type Post, type PostMutationHistory, type PostRepository, type PostSummary, type PostVersion, type PostVersionSummary } from "@vc/core";
import { createDbClient } from "../client";
import { apiKeys, postVersions, posts, user, type PostRow } from "../schema";

type ScheduleProjection = { versionNumber: number; publishAt: number; status: "pending" | "processing" | "published" | "failed"; error: string | null };
function parseSchedule(raw: string | null | undefined): ScheduleProjection | null {
  return raw ? JSON.parse(raw) as ScheduleProjection : null;
}
const scheduleProjection = sql<string | null>`(SELECT json_object('versionNumber', s.version_number, 'publishAt', s.publish_at,
  'status', s.status, 'error', s.error) FROM post_schedules s WHERE s.post_id = posts.id AND s.site_id = posts.site_id)`;

function now() {
  return Math.floor(Date.now() / 1000);
}

// Rapid same-actor post.updated events (autosave, agent drafting) within this
// window coalesce into one activity row instead of one row per save.
const POST_UPDATE_COALESCE_WINDOW_SECONDS = 600;

// Same-actor autosaves fold into the tip version for this long, so history
// holds meaningful checkpoints instead of one version per keystroke burst.
const VERSION_COALESCE_WINDOW_SECONDS = 600;
const NO_CHANGE_SUMMARY = "Saved without changes";

function isEditSummary(summary: string | null) {
  return summary === NO_CHANGE_SUMMARY || (summary?.startsWith("Edited ") ?? false);
}

function mergeEditFields(tipSummary: string | null, fields: string[]) {
  const merged = tipSummary?.startsWith("Edited ")
    ? tipSummary.slice("Edited ".length).split(", ").filter(Boolean)
    : [];
  for (const field of fields) if (!merged.includes(field)) merged.push(field);
  return merged;
}

function normalizePostStatus(status: string): Post["status"] {
  return status === "published" || status === "archived" ? status : "draft";
}

function actorTypeOf(t: string): Actor["type"] {
  return t === "human" || t === "api_key" || t === "agent" ? t : "system";
}

// Drizzle returns camelCase fields (the schema maps snake_case columns); project to the core domain model.
function mapPost(
  row: PostRow,
  versions: { currentVersionNumber: number; publishedVersionNumber: number | null; publishedSlug: string | null; scheduledPublish?: string | null },
): Post {
  return {
    id: row.id,
    siteId: row.siteId,
    title: row.title,
    slug: row.slug,
    publishedSlug: versions.publishedSlug,
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
    currentVersionNumber: versions.currentVersionNumber,
    publishedVersionNumber: versions.publishedVersionNumber,
    scheduledPublish: parseSchedule(versions.scheduledPublish),
  };
}

// Summary read model: content/seo/canonical/presentation/versionNumber columns are intentionally omitted.
type PostSummaryProjection = {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  publishedSlug: string | null;
  excerpt: string | null;
  coverAssetId: string | null;
  status: string;
  publishedAt: number | null;
  tagsJson: string;
  createdAt: number;
  updatedAt: number;
  scheduledPublish?: string | null;
};
const postSummaryFields = {
  id: posts.id,
  siteId: posts.siteId,
  title: posts.title,
  slug: posts.slug,
  publishedSlug: sql<string | null>`(select pv.slug from post_versions pv where pv.id = ${posts.publishedVersionId} and pv.site_id = ${posts.siteId})`,
  excerpt: posts.excerpt,
  coverAssetId: posts.coverAssetId,
  status: posts.status,
  publishedAt: posts.publishedAt,
  tagsJson: posts.tagsJson,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
  scheduledPublish: scheduleProjection,
};
function mapPostSummary(row: PostSummaryProjection): PostSummary {
  return {
    id: row.id,
    siteId: row.siteId,
    title: row.title,
    slug: row.slug,
    publishedSlug: row.publishedSlug,
    excerpt: row.excerpt,
    coverAssetId: row.coverAssetId,
    status: normalizePostStatus(row.status),
    publishedAt: row.publishedAt,
    tags: JSON.parse(row.tagsJson) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scheduledPublish: parseSchedule(row.scheduledPublish),
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
    return new ConflictError("Use posts.get_by_slug to inspect it. Choose another slug for a new article; update the existing post only if that was intended.");
  }
  if (text.includes("idx_post_versions_post_number") || text.includes("post_versions.post_id, post_versions.version_number")) {
    return new ConflictError("Post changed since your read. Call posts.get, reconcile your changes with current content, then retry with currentVersionNumber as expectedVersionNumber.");
  }
  return error;
}

export interface D1PostRepository extends PostRepository {
  deleteArchivedPost(siteId: string, postId: string, actor: Actor): Promise<Post | null>;
  listPostRedirects(siteId: string, postId: string): Promise<string[]>;
}

export function createD1PostRepository(db: D1Database): D1PostRepository {
  const client = createDbClient(db);

  const postWithVersions = {
    post: posts,
    currentVersionNumber: sql<number>`coalesce((select max(pv.version_number) from post_versions pv where pv.site_id = posts.site_id and pv.post_id = posts.id), 0)`,
    publishedVersionNumber: sql<number | null>`(select pv.version_number from post_versions pv where pv.id = posts.published_version_id and pv.site_id = posts.site_id and pv.post_id = posts.id)`,
    publishedSlug: sql<string | null>`(select pv.slug from post_versions pv where pv.id = posts.published_version_id and pv.site_id = posts.site_id and pv.post_id = posts.id)`,
    scheduledPublish: scheduleProjection,
  };

  // Include mutable content and both version numbers in the same SQLite statement.
  const readPost = async (condition: SQL) => {
    const [row] = await client.select(postWithVersions).from(posts).where(condition).limit(1);
    return row ? mapPost(row.post, row) : null;
  };

  const slugAvailable = `NOT EXISTS (
    SELECT 1 FROM posts other
    LEFT JOIN post_versions live ON live.id = other.published_version_id
    WHERE other.site_id = ? AND other.id <> ?
      AND (other.slug = ? OR (other.status = 'published' AND live.slug = ?))
  )`;
  const slugBinds = (siteId: string, postId: string, slug: string) => [siteId, postId, slug, slug];

  const getPost = async (siteId: string, postId: string) => {
    return readPost(and(eq(posts.siteId, siteId), eq(posts.id, postId))!);
  };

  /**
   * Autosave path: fold a same-actor edit into the tip version row (renumbered
   * to tip + 1) instead of adding a row. Only when the tip is an edit by this exact actor, is
   * younger than the window, is not the live version, and the caller still
   * holds it. Returns null (caller cuts a normal version) when not eligible
   * or when the tip moved between the read and the write.
   */
  const coalesceIntoTip = async (
    before: Post,
    patch: Partial<Post>,
    actor: Actor,
    history: PostMutationHistory,
    expectedVersionNumber: number,
  ): Promise<{ post: Post; versionNumber: number } | null> => {
    if (patch.status !== undefined && patch.status !== before.status) return null;
    if (before.currentVersionNumber !== expectedVersionNumber) return null;
    if (before.publishedVersionNumber === expectedVersionNumber) return null;
    const scheduled = await db.prepare(`SELECT 1 FROM post_schedules WHERE site_id = ? AND post_id = ?
      AND version_number = ? AND status IN ('pending', 'processing')`)
      .bind(before.siteId, before.id, expectedVersionNumber).first();
    if (scheduled) return null;
    const tip = await db
      .prepare(
        `SELECT id, created_by_type AS createdByType, created_by_id AS createdById,
           created_at AS createdAt, change_summary AS changeSummary
         FROM post_versions WHERE site_id = ? AND post_id = ? AND version_number = ?`,
      )
      .bind(before.siteId, before.id, expectedVersionNumber)
      .first<{ id: string; createdByType: string; createdById: string; createdAt: number; changeSummary: string | null }>();
    const timestamp = now();
    if (
      !tip ||
      tip.createdByType !== actor.type ||
      tip.createdById !== actor.id ||
      tip.createdAt < timestamp - VERSION_COALESCE_WINDOW_SECONDS ||
      !isEditSummary(tip.changeSummary)
    ) {
      return null;
    }

    const fields = mergeEditFields(tip.changeSummary, history.changedFields ?? []);
    const changeSummary = fields.length ? `Edited ${fields.join(", ")}` : NO_CHANGE_SUMMARY;
    // The folded row takes a new number, so anyone holding vN (an agent's
    // approval, a stale tab) gets the normal stale-version conflict. Gaps are fine.
    const nextVersionNumber = expectedVersionNumber + 1;
    const after: Post = { ...before, ...patch, updatedAt: timestamp, currentVersionNumber: nextVersionNumber, publishedVersionNumber: before.publishedVersionNumber };
    const activitySummary = await foldedActivitySummary(
      after, actor, { ...history, activitySummary: history.activitySummaryFor ? history.activitySummaryFor(fields) : history.activitySummary }, fields, timestamp,
    );

    // Every statement is gated on "this row is still the tip and not live",
    // and the renumbering write runs last. Gating the post/activity writes on
    // the renumbered row instead would let a stale concurrent save from a
    // second tab land its content after another save already folded the tip.
    const tipGate = `(SELECT max(version_number) FROM post_versions WHERE site_id = ? AND post_id = ?) = ?
      AND coalesce((SELECT published_version_id FROM posts WHERE site_id = ? AND id = ?), '') <> ?
      AND NOT EXISTS (SELECT 1 FROM post_schedules WHERE site_id = ? AND post_id = ?
        AND version_number = ? AND status IN ('pending', 'processing'))
      AND ${slugAvailable}`;
    const tipGateBinds = [before.siteId, before.id, expectedVersionNumber, before.siteId, before.id, tip.id,
      before.siteId, before.id, expectedVersionNumber, ...slugBinds(before.siteId, before.id, after.slug)];

    let results: D1Result[];
    try {
      results = await db.batch([
        db.prepare(
          `UPDATE posts
             SET title = ?, slug = ?, excerpt = ?, content_markdown = ?, cover_asset_id = ?,
               seo_title = ?, seo_description = ?, canonical_url = ?, tags_json = ?,
               presentation_json = ?, updated_by_type = ?, updated_by_id = ?, updated_at = ?
           WHERE site_id = ? AND id = ? AND ${tipGate}`,
        ).bind(
          after.title, after.slug, after.excerpt, after.contentMarkdown, after.coverAssetId,
          after.seoTitle, after.seoDescription, after.canonicalUrl, JSON.stringify(after.tags),
          after.presentation ? JSON.stringify(after.presentation) : null, actor.type, actor.id, timestamp,
          before.siteId, before.id, ...tipGateBinds,
        ),
        ...activityStatements(before, after, actor, { ...history, activitySummary }, timestamp, { sql: tipGate, binds: tipGateBinds }),
        db.prepare(
          `UPDATE post_versions
             SET version_number = ?, title = ?, slug = ?, excerpt = ?, fallback_excerpt = ?, content_markdown = ?, cover_asset_id = ?,
               seo_title = ?, seo_description = ?, canonical_url = ?, tags_json = ?,
               presentation_json = ?, change_summary = ?
           WHERE id = ? AND ${tipGate}`,
        ).bind(
          nextVersionNumber,
          after.title, after.slug, after.excerpt, firstParagraph(after.contentMarkdown), after.contentMarkdown, after.coverAssetId,
          after.seoTitle, after.seoDescription, after.canonicalUrl, JSON.stringify(after.tags),
          after.presentation ? JSON.stringify(after.presentation) : null, changeSummary,
          tip.id, ...tipGateBinds,
        ),
      ]);
    } catch (error) {
      throw mapPostError(error);
    }
    const versionResult = results[results.length - 1]!;
    if ((versionResult.meta.changes ?? 0) === 0) return null;
    return { post: (await getPost(before.siteId, before.id))!, versionNumber: nextVersionNumber };
  };

  /**
   * A post.updated event that folds into the actor's recent event spans every
   * edit since that event opened, so its summary names the fields changed
   * since the event's before-state, not just this save's fields.
   */
  const foldedActivitySummary = async (after: Post, actor: Actor, history: PostMutationHistory, fields: string[], timestamp: number) => {
    if (history.activityAction !== "post.updated" || !history.activitySummaryFor) return history.activitySummary;
    const recent = await db
      .prepare(
        `SELECT before_json AS beforeJson FROM activity_events
          WHERE site_id = ? AND entity_id = ? AND action = 'post.updated'
            AND actor_type = ? AND actor_id = ? AND created_at >= ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(after.siteId, after.id, actor.type, actor.id, timestamp - POST_UPDATE_COALESCE_WINDOW_SECONDS)
      .first<{ beforeJson: string | null }>();
    if (!recent?.beforeJson) return history.activitySummary;
    let eventBefore: Partial<Post>;
    try {
      eventBefore = JSON.parse(recent.beforeJson) as Partial<Post>;
    } catch {
      return history.activitySummary;
    }
    const merged = changedPostFields(eventBefore, after);
    for (const field of fields) if (!merged.includes(field)) merged.push(field);
    return history.activitySummaryFor(merged);
  };

  // post.updated is high-frequency (autosave, agent drafting): bump the same
  // actor's recent event instead of inserting a new row, so the ledger stays a
  // trust log rather than a keystroke log. Lifecycle actions always insert.
  // Every statement is gated so nothing lands unless the version write did.
  const activityStatements = (
    before: Post,
    after: Post,
    actor: Actor,
    history: PostMutationHistory,
    timestamp: number,
    gate: { sql: string; binds: unknown[] },
  ): D1PreparedStatement[] => {
    const activityId = crypto.randomUUID();
    const windowStart = timestamp - POST_UPDATE_COALESCE_WINDOW_SECONDS;
    const insert = (extraWhere: string, extraBinds: unknown[]) =>
      db.prepare(
        `INSERT INTO activity_events (
          id, site_id, actor_type, actor_id, actor_name, action, entity_type,
          entity_id, summary, before_json, after_json, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, 'post', ?, ?, ?, ?, ?
        WHERE ${gate.sql}${extraWhere}`,
      ).bind(
        activityId, after.siteId, actor.type, actor.id, actor.name, history.activityAction, after.id,
        history.activitySummary, JSON.stringify(before), JSON.stringify(after), timestamp,
        ...gate.binds, ...extraBinds,
      );
    if (history.activityAction !== "post.updated") return [insert("", [])];
    const recentSameActor = `SELECT id FROM activity_events
       WHERE site_id = ? AND entity_id = ? AND action = 'post.updated'
         AND actor_type = ? AND actor_id = ? AND created_at >= ?`;
    const recentBinds = [after.siteId, after.id, actor.type, actor.id, windowStart];
    return [
      db.prepare(
        `UPDATE activity_events
            SET created_at = ?, summary = ?, actor_name = ?, after_json = ?
          WHERE id = (${recentSameActor} ORDER BY created_at DESC LIMIT 1)
            AND ${gate.sql}`,
      ).bind(timestamp, history.activitySummary, actor.name, JSON.stringify(after), ...recentBinds, ...gate.binds),
      insert(` AND NOT EXISTS (${recentSameActor})`, recentBinds),
    ];
  };

  return {
    async createPostWithHistory(input, actor, history) {
      const timestamp = now();
      const post: Post = {
        ...input,
        createdAt: timestamp,
        updatedAt: timestamp,
        currentVersionNumber: 1,
        publishedVersionNumber: null,
      };
      // D1 batch is one transaction: post, version snapshot, and activity land together or not at all.
      try {
        const [insertResult] = await db.batch([
          db.prepare(`INSERT INTO posts (
            id, site_id, title, slug, excerpt, content_markdown, cover_asset_id,
            status, published_at, seo_title, seo_description, canonical_url,
            tags_json, presentation_json, published_version_id, created_by_type,
            created_by_id, updated_by_type, updated_by_id, created_at, updated_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?
          WHERE ${slugAvailable}`).bind(
            post.id, post.siteId, post.title, post.slug, post.excerpt, post.contentMarkdown,
            post.coverAssetId, post.status, post.publishedAt, post.seoTitle,
            post.seoDescription, post.canonicalUrl, JSON.stringify(post.tags),
            post.presentation ? JSON.stringify(post.presentation) : null,
            actor.type, actor.id, actor.type, actor.id, timestamp, timestamp,
            ...slugBinds(post.siteId, post.id, post.slug),
          ),
          db.prepare(`INSERT INTO post_versions (
            id, post_id, site_id, version_number, title, slug, excerpt, fallback_excerpt, content_markdown,
            cover_asset_id, status, seo_title, seo_description, canonical_url, tags_json,
            presentation_json, created_by_type, created_by_id, change_summary, created_at
          ) SELECT ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM posts WHERE id = ? AND site_id = ?)`)
            .bind(crypto.randomUUID(), post.id, post.siteId, post.title, post.slug, post.excerpt,
              firstParagraph(post.contentMarkdown), post.contentMarkdown, post.coverAssetId, post.status, post.seoTitle,
              post.seoDescription, post.canonicalUrl, JSON.stringify(post.tags),
              post.presentation ? JSON.stringify(post.presentation) : null, actor.type, actor.id,
              history.changeSummary, timestamp, post.id, post.siteId),
          db.prepare(`INSERT INTO activity_events (
            id, site_id, actor_type, actor_id, actor_name, action, entity_type,
            entity_id, summary, before_json, after_json, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, 'post', ?, ?, NULL, ?, ?
          WHERE EXISTS (SELECT 1 FROM posts WHERE id = ? AND site_id = ?)`)
            .bind(crypto.randomUUID(), post.siteId, actor.type, actor.id, actor.name,
              history.activityAction, post.id, history.activitySummary, JSON.stringify(post),
              timestamp, post.id, post.siteId),
        ]);
        if (!insertResult.meta.changes) throw new ConflictError("Use posts.get_by_slug to inspect it. Choose another slug for a new article; update the existing post only if that was intended.");
      } catch (error) {
        throw mapPostError(error);
      }
      return post;
    },

    async updatePostWithHistory(siteId, postId, patch, actor, history, expectedVersionNumber) {
      const before = await getPost(siteId, postId);
      if (!before) return null;
      if (history.coalesceVersion) {
        const coalesced = await coalesceIntoTip(before, patch, actor, history, expectedVersionNumber);
        if (coalesced) return coalesced;
      }
      const timestamp = now();
      const versionId = crypto.randomUUID();
      const nextVersionNumber = expectedVersionNumber + 1;
      const after: Post = {
        ...before,
        ...patch,
        updatedAt: timestamp,
        currentVersionNumber: nextVersionNumber,
        // Draft edits never move the public pointer.
        publishedVersionNumber: before.publishedVersionNumber,
      };
      const activitySummary = await foldedActivitySummary(after, actor, history, history.changedFields ?? [], timestamp);
      const changesLifecycle = patch.status !== undefined || patch.publishedAt !== undefined;
      const lifecycleGate = changesLifecycle
        ? `AND p.status = ? AND p.published_at IS ?
           AND (SELECT version_number FROM post_versions WHERE id = p.published_version_id) IS ?`
        : "";
      const lifecycleBinds = changesLifecycle ? [before.status, before.publishedAt, before.publishedVersionNumber] : [];

      // Claim the next version number only when the caller still holds the tip.
      // Post + activity writes are gated on that claim so a stale writer cannot
      // partially apply content or leave orphan history.
      let versionResult: D1Result;
      try {
        [versionResult] = await db.batch([
          db.prepare(
            `INSERT INTO post_versions (
              id, post_id, site_id, version_number, title, slug, excerpt, fallback_excerpt,
              content_markdown, cover_asset_id, status, seo_title, seo_description,
              canonical_url, tags_json, presentation_json, created_by_type,
              created_by_id, change_summary, created_at
            )
            SELECT ?, p.id, p.site_id, ?, ?, ?, ?, ?,
              ?, ?, ${patch.status === undefined ? "p.status" : "?"}, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?
            FROM posts AS p
            WHERE p.site_id = ? AND p.id = ?
              AND coalesce((
                SELECT max(pv.version_number)
                FROM post_versions AS pv
                WHERE pv.post_id = p.id AND pv.site_id = p.site_id
              ), 0) = ?
              ${lifecycleGate}
              AND ${slugAvailable}`,
          ).bind(
            versionId,
            nextVersionNumber,
            after.title,
            after.slug,
            after.excerpt,
            firstParagraph(after.contentMarkdown),
            after.contentMarkdown,
            after.coverAssetId,
            ...(patch.status === undefined ? [] : [after.status]),
            after.seoTitle,
            after.seoDescription,
            after.canonicalUrl,
            JSON.stringify(after.tags),
            after.presentation ? JSON.stringify(after.presentation) : null,
            actor.type,
            actor.id,
            history.changeSummary,
            timestamp,
            siteId,
            postId,
            expectedVersionNumber,
            ...lifecycleBinds,
            ...slugBinds(siteId, postId, after.slug),
          ),
          db.prepare(
            `UPDATE posts
             SET title = ?, slug = ?, excerpt = ?, content_markdown = ?,
               cover_asset_id = ?, ${changesLifecycle ? "status = ?, published_at = ?," : ""} seo_title = ?,
               seo_description = ?, canonical_url = ?, tags_json = ?,
               presentation_json = ?, updated_by_type = ?, updated_by_id = ?,
               updated_at = ?
             WHERE site_id = ? AND id = ?
               AND EXISTS (SELECT 1 FROM post_versions WHERE id = ?)`,
          ).bind(
            after.title,
            after.slug,
            after.excerpt,
            after.contentMarkdown,
            after.coverAssetId,
            ...(changesLifecycle ? [after.status, after.publishedAt] : []),
            after.seoTitle,
            after.seoDescription,
            after.canonicalUrl,
            JSON.stringify(after.tags),
            after.presentation ? JSON.stringify(after.presentation) : null,
            actor.type,
            actor.id,
            timestamp,
            siteId,
            postId,
            versionId,
          ),
          ...(patch.status === "archived" ? [db.prepare(`DELETE FROM post_schedules
            WHERE site_id = ? AND post_id = ? AND status IN ('pending', 'failed', 'processing')
              AND EXISTS (SELECT 1 FROM post_versions WHERE id = ?)`)
            .bind(siteId, postId, versionId)] : []),
          ...activityStatements(before, after, actor, { ...history, activitySummary }, timestamp, {
            sql: "EXISTS (SELECT 1 FROM post_versions WHERE id = ?)",
            binds: [versionId],
          }),
        ]);
      } catch (error) {
        throw mapPostError(error);
      }

      if ((versionResult.meta.changes ?? 0) === 0) {
        const available = await db.prepare(`SELECT ${slugAvailable} AS available`)
          .bind(...slugBinds(siteId, postId, after.slug)).first<{ available: number }>();
        if (!available?.available) throw new ConflictError("Use posts.get_by_slug to inspect it. Choose another slug for a new article; update the existing post only if that was intended.");
        throw new ConflictError("Post changed since your read. Call posts.get, reconcile your changes with current content, then retry with currentVersionNumber as expectedVersionNumber.");
      }
      return { post: (await getPost(siteId, postId))!, versionNumber: nextVersionNumber };
    },

    getPost,

    async findPostBySlug(siteId, slug) {
      return readPost(and(eq(posts.siteId, siteId), eq(posts.slug, slug))!);
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

    async publishPostWithHistory(siteId, postId, expectedVersionNumber, actor, history, options) {
      const before = await getPost(siteId, postId);
      if (!before) return { post: null, capReached: false, versionConflict: false };
      const approved = await this.getPostVersion(siteId, postId, expectedVersionNumber);
      if (!approved) return { post: null, capReached: false, versionConflict: true };

      // Even an idempotent approval must not accept a legacy duplicate live URL.
      if (!options.scheduleLeaseToken && before.status === "published" && before.publishedVersionNumber === expectedVersionNumber &&
          (options.allowOlderVersion || before.currentVersionNumber === expectedVersionNumber)) {
        const available = await db.prepare(`SELECT ${slugAvailable} AS available`)
          .bind(...slugBinds(siteId, postId, approved.slug)).first<{ available: number }>();
        if (!available?.available) throw new ConflictError("Use posts.get_by_slug to inspect it. Choose another slug for a new article; update the existing post only if that was intended.");
        return { post: before, capReached: false, versionConflict: false };
      }

      const timestamp = now();
      const activityId = crypto.randomUUID();
      const after: Post = {
        ...before,
        status: "published",
        publishedSlug: approved.slug,
        publishedAt: before.status === "published" && before.publishedAt != null ? before.publishedAt : timestamp,
        updatedAt: timestamp,
        publishedVersionNumber: expectedVersionNumber,
        currentVersionNumber: before.currentVersionNumber,
      };

      // Atomically pin the approved tip version. No new version row is created —
      // publish only moves the public pointer (and status on first publish).
      let updateResult: D1Result;
      try {
        [updateResult] = await db.batch([
          db.prepare(
            `UPDATE posts
             SET status = 'published',
               published_at = CASE
                 WHEN status = 'published' AND published_at IS NOT NULL THEN published_at
                 ELSE ?
               END,
               published_version_id = (
                 SELECT pv.id FROM post_versions AS pv
                 WHERE pv.post_id = posts.id AND pv.site_id = posts.site_id
                   AND pv.version_number = ?
               ),
               updated_at = ?,
               updated_by_type = ?,
               updated_by_id = ?
             WHERE site_id = ? AND id = ? AND status <> 'archived'
               AND (? IS NULL OR EXISTS (SELECT 1 FROM post_schedules AS schedule
                 WHERE schedule.site_id = posts.site_id AND schedule.post_id = posts.id
                   AND schedule.version_number = ? AND schedule.status = 'processing'
                   AND schedule.lease_token = ?))
               AND (? = 1 OR coalesce((
                 SELECT max(pv.version_number)
                 FROM post_versions AS pv
                 WHERE pv.post_id = posts.id AND pv.site_id = posts.site_id
               ), 0) = ?)
               AND EXISTS (
                 SELECT 1 FROM post_versions AS pv
                 WHERE pv.post_id = posts.id AND pv.site_id = posts.site_id
                   AND pv.version_number = ?
               )
               AND NOT EXISTS (
                 SELECT 1 FROM posts AS other
                 LEFT JOIN post_versions AS live ON live.id = other.published_version_id
                 WHERE other.site_id = posts.site_id AND other.id <> posts.id
                   AND (other.slug = (
                     SELECT slug FROM post_versions WHERE post_id = posts.id AND version_number = ?
                   ) OR (other.status = 'published' AND live.slug = (
                     SELECT slug FROM post_versions WHERE post_id = posts.id AND version_number = ?
                   )))
               )
               AND (
                 status = 'published'
                 OR ? = 1
                 OR (
                   SELECT count(*)
                   FROM posts AS published
                   WHERE published.site_id = posts.site_id
                     AND published.status = 'published'
                 ) < ?
               )
               AND (
                 published_version_id IS NULL
                 OR published_version_id <> (
                   SELECT pv.id FROM post_versions AS pv
                   WHERE pv.post_id = posts.id AND pv.site_id = posts.site_id
                     AND pv.version_number = ?
                 )
                 OR status <> 'published'
               )`,
          ).bind(
            timestamp,
            expectedVersionNumber,
            timestamp,
            actor.type,
            actor.id,
            siteId,
            postId,
            options.scheduleLeaseToken ?? null,
            expectedVersionNumber,
            options.scheduleLeaseToken ?? null,
            options.allowOlderVersion ? 1 : 0,
            expectedVersionNumber,
            expectedVersionNumber,
            expectedVersionNumber,
            expectedVersionNumber,
            options.billingActive ? 1 : 0,
            options.freeLimit,
            expectedVersionNumber,
          ),
          // The last live URL redirects to the new one, including after an
          // archive -> draft -> rename -> republish; never take over a slug that
          // another post is live at now.
          db.prepare(`INSERT INTO post_slug_redirects (site_id, from_slug, post_id, created_at)
            SELECT ?, ?, ?, ? WHERE changes() = 1 AND ? IS NOT NULL AND ? <> ?
              AND (? IS NULL OR EXISTS (SELECT 1 FROM post_schedules
                WHERE site_id = ? AND post_id = ? AND version_number = ?
                  AND status = 'processing' AND lease_token = ?))
              AND NOT EXISTS (SELECT 1 FROM posts AS other
                JOIN post_versions AS live ON live.id = other.published_version_id
                WHERE other.site_id = ? AND other.id <> ? AND other.status = 'published' AND live.slug = ?)
            ON CONFLICT(site_id, from_slug) DO UPDATE SET post_id = excluded.post_id, created_at = excluded.created_at`)
            .bind(siteId, before.publishedSlug, postId, timestamp, before.publishedSlug, before.publishedSlug, approved.slug,
              options.scheduleLeaseToken ?? null, siteId, postId, expectedVersionNumber, options.scheduleLeaseToken ?? null,
              siteId, postId, before.publishedSlug),
          db.prepare(`DELETE FROM post_slug_redirects WHERE site_id = ? AND from_slug = ?
            AND (? IS NULL OR EXISTS (SELECT 1 FROM post_schedules
              WHERE site_id = ? AND post_id = ? AND version_number = ?
                AND status = 'processing' AND lease_token = ?))
            AND EXISTS (SELECT 1 FROM posts WHERE site_id = ? AND id = ? AND status = 'published'
              AND published_version_id = (SELECT id FROM post_versions WHERE site_id = ? AND post_id = ? AND version_number = ?))`)
            .bind(siteId, approved.slug, options.scheduleLeaseToken ?? null, siteId, postId,
              expectedVersionNumber, options.scheduleLeaseToken ?? null, siteId, postId, siteId, postId, expectedVersionNumber),
          db.prepare(
            `INSERT INTO activity_events (
              id, site_id, actor_type, actor_id, actor_name, action, entity_type,
              entity_id, summary, before_json, after_json, created_at
            )
            SELECT ?, ?, ?, ?, ?, ?, 'post', ?, ?, ?, ?, ?
            FROM posts
            WHERE site_id = ? AND id = ? AND status = 'published'
              AND (? IS NULL OR EXISTS (SELECT 1 FROM post_schedules AS schedule
                WHERE schedule.site_id = posts.site_id AND schedule.post_id = posts.id
                  AND schedule.version_number = ? AND schedule.status = 'processing'
                  AND schedule.lease_token = ?))
              AND published_version_id = (
                SELECT pv.id FROM post_versions AS pv
                WHERE pv.post_id = posts.id AND pv.site_id = posts.site_id
                  AND pv.version_number = ?
              )
              AND updated_at = ?`,
          ).bind(
            activityId,
            siteId,
            actor.type,
            actor.id,
            actor.name,
            history.activityAction,
            postId,
            history.activitySummary,
            JSON.stringify(before),
            JSON.stringify(after),
            timestamp,
            siteId,
            postId,
            options.scheduleLeaseToken ?? null,
            expectedVersionNumber,
            options.scheduleLeaseToken ?? null,
            expectedVersionNumber,
            timestamp,
          ),
        ]);
      } catch (error) {
        throw mapPostError(error);
      }

      if ((updateResult.meta.changes ?? 0) > 0) {
        return { post: after, capReached: false, versionConflict: false };
      }

      const current = await getPost(siteId, postId);
      if (!current) return { post: null, capReached: false, versionConflict: false };
      if (current.status === "archived") throw new ConflictError("Post is archived; publication was not performed. Confirm restoration with the owner, unarchive, then review and approve the draft.");
      if (options.scheduleLeaseToken) {
        const lease = await db.prepare(`SELECT 1 FROM post_schedules WHERE site_id = ? AND post_id = ?
          AND version_number = ? AND status = 'processing' AND lease_token = ?`)
          .bind(siteId, postId, expectedVersionNumber, options.scheduleLeaseToken).first();
        if (!lease) throw new ConflictError("Schedule lease expired");
      }
      if (!options.allowOlderVersion && current.currentVersionNumber !== expectedVersionNumber) {
        return { post: null, capReached: false, versionConflict: true };
      }
      const target = await db.prepare("SELECT slug FROM post_versions WHERE site_id = ? AND post_id = ? AND version_number = ?")
        .bind(siteId, postId, expectedVersionNumber).first<{ slug: string }>();
      if (target) {
        const available = await db.prepare(`SELECT ${slugAvailable} AS available`)
          .bind(...slugBinds(siteId, postId, target.slug)).first<{ available: number }>();
        if (!available?.available) throw new ConflictError("Use posts.get_by_slug to inspect it. Choose another slug for a new article; update the existing post only if that was intended.");
      }
      if (
        current.status === "published" &&
        current.publishedVersionNumber === expectedVersionNumber
      ) {
        return { post: current, capReached: false, versionConflict: false };
      }
      return { post: null, capReached: true, versionConflict: false };
    },

    async deleteArchivedPost(siteId: string, postId: string, actor: Actor) {
      const before = await getPost(siteId, postId);
      if (!before) return null;
      if (before.status !== "archived") throw new ConflictError("Only archived posts can be permanently deleted");
      const timestamp = now();
      const [, event, deleted] = await db.batch([
        // Forever means the writing is gone, not the record of who did what:
        // keep the post's history, drop the content snapshots it carried.
        db.prepare(`UPDATE activity_events SET before_json = NULL, after_json = NULL
          WHERE site_id = ? AND entity_type = 'post' AND entity_id = ?
          AND EXISTS (SELECT 1 FROM posts WHERE site_id = ? AND id = ? AND status = 'archived')`)
          .bind(siteId, postId, siteId, postId),
        db.prepare(`INSERT INTO activity_events (
          id, site_id, actor_type, actor_id, actor_name, action, entity_type,
          entity_id, summary, before_json, after_json, created_at
        ) SELECT ?, ?, ?, ?, ?, 'post.deleted', 'post', ?, ?, NULL, NULL, ?
          FROM posts WHERE site_id = ? AND id = ? AND status = 'archived'`)
          .bind(crypto.randomUUID(), siteId, actor.type, actor.id, actor.name, postId,
            `Deleted ${before.title}`, timestamp, siteId, postId),
        db.prepare("DELETE FROM posts WHERE site_id = ? AND id = ? AND status = 'archived'")
          .bind(siteId, postId),
      ]);
      if (!deleted.meta.changes) {
        if (event.meta.changes) throw new Error("Post deletion did not follow activity event");
        const current = await getPost(siteId, postId);
        if (current) throw new ConflictError("Only archived posts can be permanently deleted");
        return null;
      }
      return before;
    },

    async listPostRedirects(siteId: string, postId: string): Promise<string[]> {
      const result = await db.prepare("SELECT from_slug FROM post_slug_redirects WHERE site_id = ? AND post_id = ? ORDER BY created_at, from_slug")
        .bind(siteId, postId).all<{ from_slug: string }>();
      return result.results.map((row) => row.from_slug);
    },

    async listPostVersions(siteId, postId) {
      // actorName = COALESCE(non-blank user.name, user.email, api_keys.actor_name, created_by_id) resolved via left joins.
      const rows = await client
        .select({
          versionNumber: postVersions.versionNumber,
          title: postVersions.title,
          slug: postVersions.slug,
          status: postVersions.status,
          changeSummary: postVersions.changeSummary,
          createdByType: postVersions.createdByType,
          createdAt: postVersions.createdAt,
          actorName: sql<string>`coalesce(nullif(trim(${user.name}), ''), ${user.email}, ${apiKeys.actorName}, ${postVersions.createdById})`,
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
          actorName: sql<string>`coalesce(nullif(trim(${user.name}), ''), ${user.email}, ${apiKeys.actorName}, ${postVersions.createdById})`,
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
