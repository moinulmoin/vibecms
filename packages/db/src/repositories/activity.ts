import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ActivityInput } from "@vc/core";
import { activityEvents, type ActivityEventRow } from "../schema";
import { createDbClient } from "../client";

// Paged activity projection for cms.getActivity. Before/after snapshots are
// reduced in SQL to the few fields the feed summarizes, never whole bodies.
export interface ActivityListEntry {
  id: string;
  action: string;
  summary: string;
  actorType: ActivityEventRow["actorType"];
  actorName: string;
  entityType: string;
  entityId: string;
  createdAt: number;
  before: ActivitySnapshotFields | null;
  after: ActivitySnapshotFields | null;
}

export interface ActivitySnapshotFields {
  title: string | null;
  slug: string | null;
  status: string | null;
  altText: string | null;
  name: string | null;
  bodyLength: number | null;
}

export type ActivityActorFilter = Array<ActivityEventRow["actorType"]>;

// Shared activity-event repository so posts/assets/api-keys/sites don't duplicate activity SQL.
export interface ActivityRepository {
  create(input: ActivityInput): Promise<void>;
  listBySite(siteId: string, limit: number): Promise<ActivityEventRow[]>;
  // Paged list (LIMIT/OFFSET) for the dashboard activity feed (cms.getActivity).
  listBySitePaged(
    siteId: string,
    limit: number,
    offset: number,
    actorTypes?: ActivityActorFilter,
  ): Promise<ActivityListEntry[]>;
  // Newest activity rows for a site filtered to one action (e.g. 'post.published').
  listBySiteAndAction(siteId: string, action: string, limit: number): Promise<ActivityEventRow[]>;
}

export function createActivityRepository(db: D1Database): ActivityRepository {
  const client = createDbClient(db);
  return {
    async create(input: ActivityInput) {
      await client
        .insert(activityEvents)
        .values({
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
          createdAt: Math.floor(Date.now() / 1000),
        })
        .run();
    },
    async listBySite(siteId: string, limit: number): Promise<ActivityEventRow[]> {
      return client
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.siteId, siteId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);
    },
    async listBySitePaged(
      siteId: string,
      limit: number,
      offset: number,
      actorTypes?: ActivityActorFilter,
    ): Promise<ActivityListEntry[]> {
      const field = (column: typeof activityEvents.beforeJson | typeof activityEvents.afterJson, path: string) =>
        sql<string | null>`json_extract(${column}, ${path})`;
      const bodyLength = (column: typeof activityEvents.beforeJson | typeof activityEvents.afterJson) =>
        sql<number | null>`length(json_extract(${column}, '$.contentMarkdown'))`;
      const conditions = [eq(activityEvents.siteId, siteId)];
      if (actorTypes?.length) conditions.push(inArray(activityEvents.actorType, actorTypes));
      const rows = await client
        .select({
          id: activityEvents.id,
          action: activityEvents.action,
          summary: activityEvents.summary,
          actorType: activityEvents.actorType,
          actorName: activityEvents.actorName,
          entityType: activityEvents.entityType,
          entityId: activityEvents.entityId,
          createdAt: activityEvents.createdAt,
          hasBefore: sql<number>`${activityEvents.beforeJson} IS NOT NULL`,
          hasAfter: sql<number>`${activityEvents.afterJson} IS NOT NULL`,
          beforeTitle: field(activityEvents.beforeJson, "$.title"),
          beforeSlug: field(activityEvents.beforeJson, "$.slug"),
          beforeStatus: field(activityEvents.beforeJson, "$.status"),
          beforeAlt: field(activityEvents.beforeJson, "$.altText"),
          beforeName: field(activityEvents.beforeJson, "$.name"),
          beforeBody: bodyLength(activityEvents.beforeJson),
          afterTitle: field(activityEvents.afterJson, "$.title"),
          afterSlug: field(activityEvents.afterJson, "$.slug"),
          afterStatus: field(activityEvents.afterJson, "$.status"),
          afterAlt: field(activityEvents.afterJson, "$.altText"),
          afterName: field(activityEvents.afterJson, "$.name"),
          afterBody: bodyLength(activityEvents.afterJson),
        })
        .from(activityEvents)
        .where(and(...conditions))
        .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        id: row.id,
        action: row.action,
        summary: row.summary,
        actorType: row.actorType,
        actorName: row.actorName,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt,
        before: row.hasBefore
          ? {
              title: row.beforeTitle,
              slug: row.beforeSlug,
              status: row.beforeStatus,
              altText: row.beforeAlt,
              name: row.beforeName,
              bodyLength: row.beforeBody,
            }
          : null,
        after: row.hasAfter
          ? {
              title: row.afterTitle,
              slug: row.afterSlug,
              status: row.afterStatus,
              altText: row.afterAlt,
              name: row.afterName,
              bodyLength: row.afterBody,
            }
          : null,
      }));
    },
    async listBySiteAndAction(siteId: string, action: string, limit: number): Promise<ActivityEventRow[]> {
      return client
        .select()
        .from(activityEvents)
        .where(and(eq(activityEvents.siteId, siteId), eq(activityEvents.action, action)))
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);
    },
  };
}
