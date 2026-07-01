import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Post } from "@vc/core";
import { createDbClient } from "../client";
import { activityEvents, apiKeys, assets, domains, postVersions, posts, sites } from "../schema";

// The posts DB CHECK (migration 0001) allows a vestigial 'scheduled' status the schema enum omits; collapse it (and any unknown) to 'draft' — matches the prior raw dashboard path and posts.ts. The string param avoids a dead TS2367 comparison against the narrowed enum.
function normalizePostStatus(status: string): Post["status"] {
  return status === "published" || status === "archived" ? status : "draft";
}

export interface DashboardRecentPost {
  id: string;
  title: string;
  slug: string;
  status: Post["status"];
  updatedAt: number;
  publishedAt: number | null;
}

// camelCase projection of activity_events.{action,summary,actor_name,created_at} for the dashboard feed.
export interface DashboardRecentActivity {
  action: string;
  summary: string;
  actorName: string;
  createdAt: number;
}

// DB-derived dashboard aggregate. Env/request-derived fields (publicUrl, publicUrlLocal, billing status, apiUsage) and the local-default-hostname repair stay in the app layer; this returns the active default-domain row exactly like the original SELECT did.
export interface DashboardAggregate {
  site: { name: string; slug: string } | null;
  counts: { published: number; draft: number; archived: number };
  media: { bytes: number; count: number };
  tokenCount: number;
  versionCount: number;
  recentPosts: DashboardRecentPost[];
  recentActivity: DashboardRecentActivity[];
  activeDefaultHostname: string | null;
}

export interface DashboardReadModel {
  getDashboardAggregate(siteId: string): Promise<DashboardAggregate>;
}

// Dashboard aggregate read model extracted from cms-dashboard.getDashboardData's env.DB.batch. Takes a D1Database and builds its own Drizzle client; no env import. The eight read-only selects run in parallel (the plan permits this for the dashboard read-only aggregate); the returned data is identical to the original single batch.
export function createDashboardReadModel(db: D1Database): DashboardReadModel {
  const client = createDbClient(db);

  return {
    async getDashboardAggregate(siteId) {
      const [siteRows, statusRows, recentPostRows, mediaRows, tokenRows, versionRows, activityRows, domainRows] =
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
            })
            .from(posts)
            .where(eq(posts.siteId, siteId))
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
        ]);

      const counts: DashboardAggregate["counts"] = { published: 0, draft: 0, archived: 0 };
      for (const row of statusRows) counts[normalizePostStatus(row.status)] += row.count;

      const media = mediaRows[0] ?? { bytes: 0, count: 0 };

      return {
        site: siteRows[0] ?? null,
        counts,
        media: { bytes: media.bytes, count: media.count },
        tokenCount: tokenRows[0]?.count ?? 0,
        versionCount: versionRows[0]?.count ?? 0,
        recentPosts: recentPostRows.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          status: normalizePostStatus(post.status),
          updatedAt: post.updatedAt,
          publishedAt: post.publishedAt,
        })),
        recentActivity: activityRows,
        activeDefaultHostname: domainRows[0]?.hostname ?? null,
      };
    },
  };
}
