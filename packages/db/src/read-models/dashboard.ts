import { and, desc, eq, inArray, isNotNull, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Post } from "@vc/core";
import { createDbClient } from "../client";
import { activityEvents, apiKeys, assets, domains, postVersions, posts, sites, subscribers, user } from "../schema";

export interface DashboardRecentPost {
  id: string;
  title: string;
  slug: string;
  status: Post["status"];
  updatedAt: number;
  publishedAt: number | null;
  versionNumber: number | null;
}

/** Posts-page row: summary fields + latest version number + last-change actor
 * (coalesce user.name, api_keys.actor_name — null when neither matches). */
export interface DashboardPostListRow {
  id: string;
  title: string;
  slug: string;
  publishedSlug: string | null;
  /** Title/excerpt/tags of the live version (null when never published). */
  publishedTitle: string | null;
  publishedExcerpt: string | null;
  publishedTagsJson: string | null;
  excerpt: string | null;
  coverAssetId: string | null;
  status: Post["status"];
  publishedAt: number | null;
  tagsJson: string;
  createdAt: number;
  updatedAt: number;
  versionNumber: number | null;
  /** Version pinned live; null until first publish. */
  publishedVersionNumber: number | null;
  /** Who wrote the tip version (human/agent/api_key/system); null without versions. */
  latestActorType: string | null;
  updatedByType: string | null;
  updatedByName: string | null;
}

/** "Needs review": agent-written drafts, or live posts whose tip moved past the live version. */
export interface DashboardReviewPost {
  id: string;
  title: string;
  slug: string;
  status: Post["status"];
  updatedAt: number;
  publishedAt: number | null;
  versionNumber: number | null;
  publishedVersionNumber: number | null;
  latestActorType: string | null;
}

export type DashboardPostListStatus = Post["status"] | "review";
export type DashboardPostListSort = "updated" | "created" | "title" | "published";

// camelCase projection of activity_events.{action,summary,actor_name,created_at} for the dashboard feed.
export interface DashboardRecentActivity {
  action: string;
  summary: string;
  actorName: string;
  createdAt: number;
}

// All currently-published posts (no published_at<=now cutoff) for onboarding attribution.
export interface AttributionPublishedPost {
  id: string;
  title: string;
  slug: string;
  publishedAt: number | null;
}

// Site-level activation proof derived from API-key activity: the newest live
// post an api_key created/updated, or when none exists the newest draft an
// api_key created/updated. A human can approve the live version; posts without
// agent authorship never qualify. URL is appended by the app layer.
export interface ActivationDraftPost {
  id: string;
  title: string;
  slug: string;
  updatedAt: number;
  versionNumber: number;
}

export interface ActivationLivePost {
  id: string;
  title: string;
  slug: string;
  publishedAt: number;
}

export type ActivationPost =
  | { state: "waiting" }
  | { state: "draft"; post: ActivationDraftPost }
  | { state: "live"; post: ActivationLivePost; actorName: string };

// DB-derived dashboard aggregate. Env/request-derived fields (publicUrl, publicUrlLocal, billing status, apiUsage) and the local-default-hostname repair stay in the app layer; this returns the active default-domain row exactly like the original SELECT did.
export interface DashboardAggregate {
  site: { name: string; slug: string } | null;
  counts: { published: number; draft: number; archived: number };
  media: { bytes: number; count: number };
  tokenCount: number;
  subscriberCount: number;
  versionCount: number;
  recentPosts: DashboardRecentPost[];
  /** Drafts awaiting a human review decision (updatedAt desc, limit 5). */
  recentDrafts: DashboardRecentPost[];
  /** Posts waiting on a human decision (updatedAt desc, limit 5). */
  needsReview: DashboardReviewPost[];
  /** Total posts waiting on a human decision. */
  needsReviewCount: number;
  recentActivity: DashboardRecentActivity[];
  activeDefaultHostname: string | null;
}

export interface DashboardReadModel {
  getDashboardAggregate(siteId: string): Promise<DashboardAggregate>;
  /** Posts-page listing with last-change actor, one query (no per-row version lookups). */
  listPostsForDashboard(
    siteId: string,
    input: { status?: DashboardPostListStatus; search?: string; sort?: DashboardPostListSort; limit: number; offset: number },
  ): Promise<DashboardPostListRow[]>;
  // Currently-published posts (no published_at<=now cutoff) for onboarding attribution.
  listPublishedForAttribution(siteId: string, limit: number): Promise<AttributionPublishedPost[]>;
  // Site-level activation proof from api_key activity (live wins over draft). Bounded
  // joins against activity_events/posts; no app-layer array scans or raw SQL.
  getActivationPost(siteId: string): Promise<ActivationPost>;
}

// Dashboard aggregate read model extracted from cms-dashboard.getDashboardData's env.DB.batch. Takes a D1Database and builds its own Drizzle client; no env import. The eight read-only selects run in parallel (the plan permits this for the dashboard read-only aggregate); the returned data is identical to the original single batch.
// Correlated subqueries must name the outer row explicitly: in a join-free
// select Drizzle renders `${posts.id}` as a bare "id", which binds to
// post_versions.id inside the subquery and silently matches nothing.
const outerPostId = sql.raw(`"posts"."id"`);
const outerPublishedVersionId = sql.raw(`"posts"."published_version_id"`);
const tipVersionSql = sql<number>`coalesce((select max(${postVersions.versionNumber}) from ${postVersions} where ${postVersions.postId} = ${outerPostId}), 0)`;
const publishedVersionSql = sql<number | null>`(select ${postVersions.versionNumber} from ${postVersions} where ${postVersions.id} = ${outerPublishedVersionId})`;
const publishedSlugSql = sql<string | null>`(select ${postVersions.slug} from ${postVersions} where ${postVersions.id} = ${outerPublishedVersionId})`;
const publishedTitleSql = sql<string | null>`(select ${postVersions.title} from ${postVersions} where ${postVersions.id} = ${outerPublishedVersionId})`;
const publishedExcerptSql = sql<string | null>`(select coalesce(nullif(trim(${postVersions.excerpt}), ''), ${postVersions.fallbackExcerpt}) from ${postVersions} where ${postVersions.id} = ${outerPublishedVersionId})`;
const publishedTagsSql = sql<string | null>`(select ${postVersions.tagsJson} from ${postVersions} where ${postVersions.id} = ${outerPublishedVersionId})`;
const latestActorTypeSql = sql<string | null>`(select ${postVersions.createdByType} from ${postVersions} where ${postVersions.postId} = ${outerPostId} order by ${postVersions.versionNumber} desc limit 1)`;
// Agent drafts awaiting a decision, or live posts whose private tip moved past the live pin.
const needsReviewSql = sql`(
  (${posts.status} = 'draft' and ${latestActorTypeSql} in ('agent', 'api_key'))
  or (${posts.status} = 'published' and ${posts.publishedVersionId} is not null
      and coalesce(${publishedVersionSql}, 0) < ${tipVersionSql})
)`;

function escapeLike(term: string) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function createDashboardReadModel(db: D1Database): DashboardReadModel {
  const client = createDbClient(db);
  const agentActivity = alias(activityEvents, "agent_activity");

  return {
    async getDashboardAggregate(siteId) {
      const [siteRows, statusRows, recentPostRows, recentDraftRows, mediaRows, tokenRows, subscriberRows, versionRows, activityRows, domainRows, reviewRows, reviewCountRows] =
        await Promise.all([
          client.select({ name: sites.name, slug: sites.slug }).from(sites).where(eq(sites.id, siteId)).limit(1),
          client
            .select({ status: posts.status, count: sql<number>`count(*)`.mapWith(Number) })
            .from(posts)
            .where(eq(posts.siteId, siteId))
            .groupBy(posts.status),
          client
            .select({
              id: posts.id,
              title: posts.title,
              slug: posts.slug,
              status: posts.status,
              updatedAt: posts.updatedAt,
              publishedAt: posts.publishedAt,
              versionNumber: sql<number>`coalesce((select max(${postVersions.versionNumber}) from ${postVersions} where ${postVersions.postId} = ${posts.id}), 0)`,
            })
            .from(posts)
            .where(eq(posts.siteId, siteId))
            .orderBy(desc(posts.updatedAt))
            .limit(5),
          client
            .select({
              id: posts.id,
              title: posts.title,
              slug: posts.slug,
              status: posts.status,
              updatedAt: posts.updatedAt,
              publishedAt: posts.publishedAt,
              versionNumber: sql<number>`coalesce((select max(${postVersions.versionNumber}) from ${postVersions} where ${postVersions.postId} = ${posts.id}), 0)`,
            })
            .from(posts)
            .where(and(eq(posts.siteId, siteId), eq(posts.status, "draft")))
            .orderBy(desc(posts.updatedAt))
            .limit(5),
          client
            .select({
              bytes: sql<number>`coalesce(sum(${assets.sizeBytes}), 0)`.mapWith(Number),
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(assets)
            .where(eq(assets.siteId, siteId)),
          client
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(apiKeys)
            .where(and(eq(apiKeys.siteId, siteId), isNull(apiKeys.revokedAt))),
          client
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(subscribers)
            .where(eq(subscribers.siteId, siteId)),
          client
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(postVersions)
            .where(eq(postVersions.siteId, siteId)),
          client
            .select({
              action: activityEvents.action,
              summary: activityEvents.summary,
              actorName: activityEvents.actorName,
              createdAt: activityEvents.createdAt,
            })
            .from(activityEvents)
            .where(eq(activityEvents.siteId, siteId))
            .orderBy(desc(activityEvents.createdAt))
            .limit(5),
          client
            .select({ hostname: domains.hostname })
            .from(domains)
            .where(and(eq(domains.siteId, siteId), eq(domains.type, "default"), eq(domains.status, "active")))
            .limit(1),
          client
            .select({
              id: posts.id,
              title: posts.title,
              slug: posts.slug,
              status: posts.status,
              updatedAt: posts.updatedAt,
              publishedAt: posts.publishedAt,
              versionNumber: tipVersionSql,
              publishedVersionNumber: publishedVersionSql,
              latestActorType: latestActorTypeSql,
            })
            .from(posts)
            .where(and(eq(posts.siteId, siteId), needsReviewSql))
            .orderBy(desc(posts.updatedAt))
            .limit(5),
          client
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(posts)
            .where(and(eq(posts.siteId, siteId), needsReviewSql)),
        ]);

      const counts: DashboardAggregate["counts"] = { published: 0, draft: 0, archived: 0 };
      for (const row of statusRows) counts[row.status] += row.count;

      const media = mediaRows[0] ?? { bytes: 0, count: 0 };

      return {
        site: siteRows[0] ?? null,
        counts,
        media: { bytes: media.bytes, count: media.count },
        tokenCount: tokenRows[0]?.count ?? 0,
        subscriberCount: subscriberRows[0]?.count ?? 0,
        versionCount: versionRows[0]?.count ?? 0,
        recentPosts: recentPostRows.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          status: post.status,
          updatedAt: post.updatedAt,
          publishedAt: post.publishedAt,
          versionNumber: post.versionNumber,
        })),
        recentDrafts: recentDraftRows.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          status: post.status,
          updatedAt: post.updatedAt,
          publishedAt: post.publishedAt,
          versionNumber: post.versionNumber,
        })),
        needsReview: reviewRows.map((post) => ({
          ...post,
          versionNumber: post.versionNumber > 0 ? post.versionNumber : null,
        })),
        needsReviewCount: reviewCountRows[0]?.count ?? 0,
        recentActivity: activityRows,
        activeDefaultHostname: domainRows[0]?.hostname ?? null,
      };
    },
    async listPostsForDashboard(siteId, input) {
      // Site filter, status (or "review"), escaped %term% LIKE across
      // title/slug/excerpt, and a sort, plus version pins and last-change actor
      // in one query — no N+1.
      const search = input.search ? `%${escapeLike(input.search)}%` : null;
      const conditions: (SQL | undefined)[] = [eq(posts.siteId, siteId)];
      if (input.status === "review") conditions.push(needsReviewSql);
      else if (input.status) conditions.push(eq(posts.status, input.status));
      if (search) {
        conditions.push(
          or(
            sql`${posts.title} like ${search} escape '\\'`,
            sql`${posts.slug} like ${search} escape '\\'`,
            sql`${posts.excerpt} like ${search} escape '\\'`,
          ),
        );
      }
      const order =
        input.sort === "title"
          ? [sql`lower(${posts.title}) asc`, desc(posts.updatedAt)]
          : input.sort === "created"
            ? [desc(posts.createdAt)]
            : input.sort === "published"
              ? [sql`${posts.publishedAt} is null`, desc(posts.publishedAt), desc(posts.updatedAt)]
              : [desc(posts.updatedAt)];
      const rows = await client
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          publishedSlug: publishedSlugSql,
          publishedTitle: publishedTitleSql,
          publishedExcerpt: publishedExcerptSql,
          publishedTagsJson: publishedTagsSql,
          excerpt: posts.excerpt,
          coverAssetId: posts.coverAssetId,
          status: posts.status,
          publishedAt: posts.publishedAt,
          tagsJson: posts.tagsJson,
          createdAt: posts.createdAt,
          updatedAt: posts.updatedAt,
          updatedByType: posts.updatedByType,
          versionNumber: tipVersionSql,
          publishedVersionNumber: publishedVersionSql,
          latestActorType: latestActorTypeSql,
          updatedByName: sql<string | null>`coalesce(${user.name}, ${apiKeys.actorName})`,
        })
        .from(posts)
        .leftJoin(user, eq(user.id, posts.updatedById))
        .leftJoin(apiKeys, eq(apiKeys.id, posts.updatedById))
        .where(and(...conditions))
        .orderBy(...order, desc(posts.id))
        .limit(input.limit)
        .offset(input.offset);
      return rows.map((row) => ({
        ...row,
        versionNumber: row.versionNumber > 0 ? row.versionNumber : null,
      }));
    },
    async listPublishedForAttribution(siteId: string, limit: number): Promise<AttributionPublishedPost[]> {
      return client
        .select({ id: posts.id, title: posts.title, slug: posts.slug, publishedAt: posts.publishedAt })
        .from(posts)
        .where(and(eq(posts.siteId, siteId), eq(posts.status, "published")))
        .orderBy(desc(posts.publishedAt))
        .limit(limit);
    },
    async getActivationPost(siteId: string): Promise<ActivationPost> {
      // LIVE: newest publication of a currently-published post with prior
      // api_key create/update activity. The publisher may be the human approver;
      // unrelated human-only content cannot activate onboarding.
      const liveRows = await client
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          publishedAt: sql<number>`${posts.publishedAt}`.mapWith(Number),
          actorName: activityEvents.actorName,
        })
        .from(activityEvents)
        .innerJoin(posts, and(eq(posts.id, activityEvents.entityId), eq(posts.siteId, activityEvents.siteId)))
        .innerJoin(
          agentActivity,
          and(
            eq(agentActivity.siteId, activityEvents.siteId),
            eq(agentActivity.entityId, activityEvents.entityId),
            eq(agentActivity.entityType, "post"),
            eq(agentActivity.actorType, "api_key"),
            inArray(agentActivity.action, ["post.created", "post.updated"]),
            lte(agentActivity.createdAt, activityEvents.createdAt),
          ),
        )
        .where(
          and(
            eq(activityEvents.siteId, siteId),
            eq(activityEvents.entityType, "post"),
            eq(activityEvents.action, "post.published"),
            eq(posts.status, "published"),
            isNotNull(posts.publishedAt),
          ),
        )
        .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
        .limit(1);
      if (liveRows.length > 0) {
        const r = liveRows[0];
        return {
          state: "live",
          post: { id: r.id, title: r.title, slug: r.slug, publishedAt: r.publishedAt },
          actorName: r.actorName,
        };
      }

      // DRAFT only when no live post exists: newest api_key create/update activity
      // on a draft post. versionNumber is the current max version for that post.
      const draftRows = await client
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          updatedAt: posts.updatedAt,
          versionNumber: sql<number>`coalesce((select max(${postVersions.versionNumber}) from ${postVersions} where ${postVersions.postId} = ${posts.id}), 0)`.mapWith(Number),
        })
        .from(activityEvents)
        .innerJoin(posts, and(eq(posts.id, activityEvents.entityId), eq(posts.siteId, activityEvents.siteId)))
        .where(
          and(
            eq(activityEvents.siteId, siteId),
            eq(activityEvents.actorType, "api_key"),
            eq(activityEvents.entityType, "post"),
            inArray(activityEvents.action, ["post.created", "post.updated"]),
            eq(posts.status, "draft"),
          ),
        )
        .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
        .limit(1);
      if (draftRows.length > 0) {
        const r = draftRows[0];
        return {
          state: "draft",
          post: { id: r.id, title: r.title, slug: r.slug, updatedAt: r.updatedAt, versionNumber: r.versionNumber },
        };
      }

      return { state: "waiting" };
    },
  };
}
