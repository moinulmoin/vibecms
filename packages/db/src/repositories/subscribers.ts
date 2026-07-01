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
  };
}
