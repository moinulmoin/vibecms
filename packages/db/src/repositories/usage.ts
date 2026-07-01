import { eq, sql } from "drizzle-orm";
import { createDbClient } from "../client";
import { usageCounters } from "../schema";

// Counter to conditionally increment; the app computes id/period/limit from plan logic.
export type IncrementUsageInput = {
  id: string;
  workspaceId: string;
  siteId: string | null;
  period: string;
  metric: string;
  limit: number;
};

export interface UsageRepository {
  // Current counter value, 0 when the row does not exist.
  readCounter(id: string): Promise<number>;
  // Guarded upsert (INSERT value=1 ... ON CONFLICT DO UPDATE value=value+1 WHERE value+excluded.value<=limit).
  // applied is false when the limit guard rejected the increment (=> caller must deny).
  incrementCounter(input: IncrementUsageInput): Promise<{ applied: boolean }>;
  // Decrement release path: value = MAX(value - 1, 0).
  releaseCounter(id: string): Promise<void>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createUsageRepository(db: D1Database): UsageRepository {
  const client = createDbClient(db);
  return {
    async readCounter(id) {
      const rows = await client
        .select({ value: usageCounters.value })
        .from(usageCounters)
        .where(eq(usageCounters.id, id))
        .limit(1);
      return rows[0]?.value ?? 0;
    },

    async incrementCounter(input) {
      const ts = nowSeconds();
      const result = await client
        .insert(usageCounters)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          siteId: input.siteId,
          period: input.period,
          metric: input.metric,
          value: 1,
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoUpdate({
          target: usageCounters.id,
          set: {
            value: sql`${usageCounters.value} + 1`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`${usageCounters.value} + excluded.value <= ${input.limit}`,
        })
        .run();
      return { applied: result.meta.changes > 0 };
    },

    async releaseCounter(id) {
      const ts = nowSeconds();
      await client
        .update(usageCounters)
        .set({ value: sql`max(${usageCounters.value} - 1, 0)`, updatedAt: ts })
        .where(eq(usageCounters.id, id))
        .run();
    },
  };
}
