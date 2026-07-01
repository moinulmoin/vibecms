import { and, desc, eq } from "drizzle-orm";
import type { ActivityInput } from "@vc/core";
import { activityEvents, type ActivityEventRow } from "../schema";
import { createDbClient } from "../client";

// Shared activity-event repository so posts/assets/api-keys/sites don't duplicate activity SQL.
export interface ActivityRepository {
  create(input: ActivityInput): Promise<void>;
  listBySite(siteId: string, limit: number): Promise<ActivityEventRow[]>;
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
