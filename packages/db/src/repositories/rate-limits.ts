import { lt, sql } from "drizzle-orm";
import { createDbClient } from "../client";
import { rateLimits } from "../schema";

// Generic fixed-window counter input; the app computes id/window/max from its window math.
export type IncrementRateLimitInput = {
  id: string;
  // expires_at stored on first insert; not refreshed on subsequent hits within the window.
  windowExpiresAt: number;
  max: number;
  // Timestamp used for created_at / updated_at.
  now: number;
};

export interface RateLimitsRepository {
  // Guarded upsert (INSERT count=1 ... ON CONFLICT DO UPDATE count=count+1 WHERE count<max).
  // allowed is true when the increment applied (changes>0); false when the window cap rejected it.
  increment(input: IncrementRateLimitInput): Promise<{ allowed: boolean }>;
  // DELETE WHERE expires_at < now; used by the probabilistic cleanup the caller gates.
  deleteExpired(now: number): Promise<void>;
}

export function createRateLimitsRepository(db: D1Database): RateLimitsRepository {
  const client = createDbClient(db);
  return {
    async increment(input) {
      const result = await client
        .insert(rateLimits)
        .values({
          id: input.id,
          count: 1,
          expiresAt: input.windowExpiresAt,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: rateLimits.id,
          set: {
            count: sql`${rateLimits.count} + 1`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`${rateLimits.count} < ${input.max}`,
        })
        .run();
      return { allowed: result.meta.changes > 0 };
    },

    async deleteExpired(now) {
      await client.delete(rateLimits).where(lt(rateLimits.expiresAt, now)).run();
    },
  };
}
