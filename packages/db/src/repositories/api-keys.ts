import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { createDbClient } from "../client";
import { apiKeys, sites } from "../schema";

// CamelCase read model for the dashboard token list. scopesJson is left as a string;
// the app parses it into Scope[] (it never needs the pepper or raw token here).
export interface ApiKeyRecord {
  id: string;
  siteId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopesJson: string;
  actorName: string;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

// Auth read model: api_keys joined to sites for workspace_id. The app checks revoked_at and
// parses scopes_json; the repo only reads (it never sees the raw token or TOKEN_PEPPER).
export interface ApiKeyAuthRecord {
  id: string;
  siteId: string;
  workspaceId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopesJson: string;
  actorName: string;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

// Minimal projection for the onboarding-status "newest key" reads.
export interface ApiKeyStatusRecord {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

// Caller supplies already-hashed/derived values; the repo never touches the raw token or pepper.
export interface InsertKeyInput {
  id: string;
  siteId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopesJson: string;
  actorName: string;
  createdByUserId: string;
  // Single caller-chosen timestamp used for both created_at and updated_at.
  timestamp: number;
}

export interface ApiKeysRepository {
  // Active tokens for a site (revoked_at IS NULL), newest first, capped at 100.
  listActive(siteId: string): Promise<ApiKeyRecord[]>;
  // Count of active tokens for the create-limit check.
  countActive(siteId: string): Promise<number>;
  // Insert a new key row from already-hashed values.
  insertKey(input: InsertKeyInput): Promise<void>;
  // SOFT revoke: set revoked_at + updated_at scoped to (id, site_id). Returns affected rows so
  // the app can tell not-found from success. The row is NEVER deleted (audit attribution).
  revoke(siteId: string, keyId: string, timestamp: number): Promise<number>;
  // Look up a key by token_hash joined to sites for workspace_id, or null when absent.
  authenticateByHash(tokenHash: string): Promise<ApiKeyAuthRecord | null>;
  // Record last-used touch on a successful authentication. Monotonic: an older
  // timestamp never overwrites a newer lastUsedAt.
  markUsed(keyId: string, timestamp: number): Promise<void>;
  // Exact site-scoped key by id, including revoked rows, or null when absent.
  // Used by the selected-key onboarding read; never falls back to another token.
  getById(siteId: string, keyId: string): Promise<ApiKeyStatusRecord | null>;
  // Newest active key for a site, or null (onboarding-status active-key read).
  latestActive(siteId: string): Promise<ApiKeyStatusRecord | null>;
  // Newest key of any state for a site, or null (onboarding-status revoked fallback read).
  latestAny(siteId: string): Promise<ApiKeyStatusRecord | null>;
}

const recordFields = {
  id: apiKeys.id,
  siteId: apiKeys.siteId,
  name: apiKeys.name,
  tokenPrefix: apiKeys.tokenPrefix,
  tokenHash: apiKeys.tokenHash,
  scopesJson: apiKeys.scopesJson,
  actorName: apiKeys.actorName,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  createdAt: apiKeys.createdAt,
} as const;

const statusFields = {
  id: apiKeys.id,
  name: apiKeys.name,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
} as const;

// API-token persistence. Token generation, HMAC hashing (env.TOKEN_PEPPER), scope parsing, and
// owner gating stay in the app; this repo only reads/writes already-hashed values. Takes a
// D1Database and builds its own Drizzle client; no env import.
export function createApiKeysRepository(db: D1Database): ApiKeysRepository {
  const client = createDbClient(db);

  return {
    async listActive(siteId) {
      return client
        .select(recordFields)
        .from(apiKeys)
        .where(and(eq(apiKeys.siteId, siteId), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt))
        .limit(100);
    },

    async countActive(siteId) {
      const rows = await client
        .select({ count: sql<number>`count(*)` })
        .from(apiKeys)
        .where(and(eq(apiKeys.siteId, siteId), isNull(apiKeys.revokedAt)));
      return Number(rows[0]?.count ?? 0);
    },

    async insertKey(input) {
      await client.insert(apiKeys).values({
        id: input.id,
        siteId: input.siteId,
        name: input.name,
        tokenPrefix: input.tokenPrefix,
        tokenHash: input.tokenHash,
        scopesJson: input.scopesJson,
        actorName: input.actorName,
        createdByUserId: input.createdByUserId,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      });
    },

    async revoke(siteId, keyId, timestamp) {
      const result = await client
        .update(apiKeys)
        .set({ revokedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.siteId, siteId)))
        .run();
      return result.meta.changes ?? 0;
    },

    async authenticateByHash(tokenHash) {
      const rows = await client
        .select({
          id: apiKeys.id,
          siteId: apiKeys.siteId,
          workspaceId: sites.workspaceId,
          name: apiKeys.name,
          tokenPrefix: apiKeys.tokenPrefix,
          tokenHash: apiKeys.tokenHash,
          scopesJson: apiKeys.scopesJson,
          actorName: apiKeys.actorName,
          lastUsedAt: apiKeys.lastUsedAt,
          revokedAt: apiKeys.revokedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .innerJoin(sites, eq(sites.id, apiKeys.siteId))
        .where(eq(apiKeys.tokenHash, tokenHash))
        .limit(1);
      return rows[0] ?? null;
    },

    async markUsed(keyId, timestamp) {
      // Monotonic: only advance lastUsedAt. A stale (older) timestamp cannot
      // overwrite a value already set by a newer authentication.
      await client
        .update(apiKeys)
        .set({ lastUsedAt: timestamp })
        .where(and(eq(apiKeys.id, keyId), or(isNull(apiKeys.lastUsedAt), sql`${apiKeys.lastUsedAt} < ${timestamp}`)))
        .run();
    },

    async getById(siteId, keyId) {
      const rows = await client
        .select(statusFields)
        .from(apiKeys)
        .where(and(eq(apiKeys.siteId, siteId), eq(apiKeys.id, keyId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async latestActive(siteId) {
      const rows = await client
        .select(statusFields)
        .from(apiKeys)
        .where(and(eq(apiKeys.siteId, siteId), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async latestAny(siteId) {
      const rows = await client
        .select(statusFields)
        .from(apiKeys)
        .where(eq(apiKeys.siteId, siteId))
        .orderBy(desc(apiKeys.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
