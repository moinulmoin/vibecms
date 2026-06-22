import { ConflictError, type DomainRecord, type DomainRepository } from "@vc/core";

type DomainRow = {
  id: string;
  site_id: string;
  hostname: string;
  type: string;
  status: string;
  cloudflare_custom_hostname_id: string | null;
  verification_errors_json: string | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS =
  "id, site_id, hostname, type, status, cloudflare_custom_hostname_id, verification_errors_json, created_at, updated_at";

function mapDomain(row: DomainRow): DomainRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    hostname: row.hostname,
    type: row.type === "custom" ? "custom" : "default",
    status:
      row.status === "active" || row.status === "failed" || row.status === "disabled" ? row.status : "pending",
    cloudflareCustomHostnameId: row.cloudflare_custom_hostname_id,
    verificationErrorsJson: row.verification_errors_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createD1DomainRepository(db: D1Database): DomainRepository {
  return {
    async listBySite(siteId) {
      const result = await db
        .prepare(`SELECT ${COLUMNS} FROM domains WHERE site_id = ? ORDER BY created_at ASC`)
        .bind(siteId)
        .all<DomainRow>();
      return result.results.map(mapDomain);
    },
    async getByHostname(hostname) {
      const row = await db
        .prepare(`SELECT ${COLUMNS} FROM domains WHERE hostname = ? LIMIT 1`)
        .bind(hostname)
        .first<DomainRow>();
      return row ? mapDomain(row) : null;
    },
    async insert(record) {
      try {
        await db
          .prepare(`INSERT INTO domains (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            record.id,
            record.siteId,
            record.hostname,
            record.type,
            record.status,
            record.cloudflareCustomHostnameId,
            record.verificationErrorsJson,
            record.createdAt,
            record.updatedAt,
          )
          .run();
      } catch (error) {
        if (error instanceof Error && /UNIQUE/i.test(error.message)) {
          throw new ConflictError("That domain is already connected to another blog.");
        }
        throw error;
      }
    },
    async reclaimStale(hostname, staleBeforeUpdatedAt) {
      const result = await db
        .prepare(
          `DELETE FROM domains WHERE hostname = ? AND type = 'custom' AND status IN ('pending', 'failed') AND updated_at <= ?`,
        )
        .bind(hostname, staleBeforeUpdatedAt)
        .run();
      return result.meta.changes ?? 0;
    },
    async deleteCustomForSite(id, siteId) {
      const result = await db
        .prepare(`DELETE FROM domains WHERE id = ? AND site_id = ? AND type = 'custom'`)
        .bind(id, siteId)
        .run();
      return result.meta.changes ?? 0;
    },
  };
}
