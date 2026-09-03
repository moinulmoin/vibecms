import { and, desc, eq, like, sql } from "drizzle-orm";
import { createDbClient } from "../client";
import { subscribers } from "../schema";

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

function conditionsFor(siteId: string, input: SubscriberCountInput = {}) {
  const conditions = [eq(subscribers.siteId, siteId)];
  const search = input.search?.trim().slice(0, 120);
  if (search) conditions.push(like(subscribers.email, `%${search}%`));
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

    async deleteById(siteId: string, id: string): Promise<boolean> {
      const result = await client
        .delete(subscribers)
        .where(and(eq(subscribers.siteId, siteId), eq(subscribers.id, id)))
        .run();
      return result.meta.changes === 1;
    },
  };
}
