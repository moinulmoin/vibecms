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
  return {
    async addPending(input: AddPendingInput): Promise<{ created: boolean }> {
      const ts = Math.floor(Date.now() / 1000);
      const result = await db
        .prepare(
          `INSERT INTO subscribers (
            id, site_id, email, status, source_url, consent_text, consent_version,
            ip_hash, ua_hash, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(site_id, email) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          input.siteId,
          input.email,
          input.sourceUrl ?? null,
          input.consentText,
          input.consentVersion,
          input.ipHash ?? null,
          input.uaHash ?? null,
          ts,
          ts,
        )
        .run();
      return { created: result.meta.changes === 1 };
    },
  };
}
