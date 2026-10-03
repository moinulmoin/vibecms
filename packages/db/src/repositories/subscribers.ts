import { and, desc, eq, sql } from "drizzle-orm";
import { createDbClient } from "../client";
import { subscribers } from "../schema";
import type { Actor } from "@vc/core";

export type AddPendingInput = {
  siteId: string;
  email: string;
  sourceUrl: string | null;
  consentText: string;
  consentVersion: string;
  ipHash?: string | null;
  uaHash?: string | null;
};

export type SubscriberListRow = {
  id: string;
  email: string;
  status: "pending" | "confirmed" | "unsubscribed";
  sourceUrl: string | null;
  createdAt: number;
  consentVersion: string;
};

export type SubscriberListInput = {
  siteId: string;
  search?: string;
  status?: "pending" | "confirmed" | "unsubscribed";
  limit: number;
  offset: number;
};

export type SubscriberCountInput = {
  search?: string;
  status?: "pending" | "confirmed" | "unsubscribed";
};

/** Treat `%`, `_`, and backslash in a search term as literal characters. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function conditionsFor(siteId: string, input: SubscriberCountInput = {}) {
  const conditions = [eq(subscribers.siteId, siteId)];
  const search = input.search?.trim().slice(0, 120);
  if (search) {
    const pattern = `%${escapeLike(search.toLowerCase())}%`;
    conditions.push(sql`lower(${subscribers.email}) LIKE ${pattern} ESCAPE '\\'`);
  }
  if (input.status) conditions.push(eq(subscribers.status, input.status));
  return conditions;
}

export function createD1SubscriberRepository(db: D1Database) {
  const client = createDbClient(db);
  return {
    async addPending(input: AddPendingInput): Promise<{ created: boolean }> {
      const ts = Math.floor(Date.now() / 1000);
      const result = await client
        .insert(subscribers)
        .values({
          id: crypto.randomUUID(),
          siteId: input.siteId,
          email: input.email,
          status: "pending",
          sourceUrl: input.sourceUrl ?? null,
          consentText: input.consentText,
          consentVersion: input.consentVersion,
          ipHash: input.ipHash ?? null,
          uaHash: input.uaHash ?? null,
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoNothing({ target: [subscribers.siteId, subscribers.email] })
        .run();
      return { created: result.meta.changes === 1 };
    },

    async list(input: SubscriberListInput): Promise<SubscriberListRow[]> {
      const rows = await client
        .select({
          id: subscribers.id,
          email: subscribers.email,
          status: subscribers.status,
          sourceUrl: subscribers.sourceUrl,
          createdAt: subscribers.createdAt,
          consentVersion: subscribers.consentVersion,
        })
        .from(subscribers)
        .where(and(...conditionsFor(input.siteId, input)))
        .orderBy(desc(subscribers.createdAt), desc(subscribers.id))
        .limit(Math.max(0, Math.floor(input.limit)))
        .offset(Math.max(0, Math.floor(input.offset)));
      return rows;
    },

    async count(siteId: string, input: SubscriberCountInput = {}) {
      const totalRows = await client
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(subscribers)
        .where(and(...conditionsFor(siteId, input)));
      const pendingRows = await client
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(subscribers)
        .where(and(...conditionsFor(siteId, { search: input.search, status: "pending" })));
      return {
        total: totalRows[0]?.count ?? 0,
        pendingCount: pendingRows[0]?.count ?? 0,
      };
    },

    async deleteById(siteId: string, id: string, actor: Actor): Promise<boolean> {
      const [activity] = await db.batch([
        db.prepare(`INSERT INTO activity_events
          (id, site_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, created_at)
          SELECT ?, site_id, ?, ?, ?, 'subscriber.deleted', 'subscriber', id,
            'Deleted subscriber ' || substr(email, 1, 1) || '***' || substr(email, instr(email, '@')),
            ? FROM subscribers WHERE site_id = ? AND id = ?`)
          .bind(crypto.randomUUID(), actor.type, actor.id, actor.name, Math.floor(Date.now() / 1000), siteId, id),
        db.prepare("DELETE FROM subscribers WHERE site_id = ? AND id = ?").bind(siteId, id),
      ]);
      return activity.meta.changes === 1;
    },
  };
}
