import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { ConflictError, type DomainRecord, type DomainRepository } from "@vc/core";
import { createDbClient } from "../client";
import { domains, type DomainRow } from "../schema";

function mapDomain(row: DomainRow): DomainRecord {
  return {
    id: row.id,
    siteId: row.siteId,
    hostname: row.hostname,
    type: row.type === "custom" ? "custom" : "default",
    status:
      row.status === "active" || row.status === "failed" || row.status === "disabled" ? row.status : "pending",
    cloudflareCustomHostnameId: row.cloudflareCustomHostnameId,
    verificationErrorsJson: row.verificationErrorsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createD1DomainRepository(db: D1Database): DomainRepository {
  const client = createDbClient(db);
  return {
    async listBySite(siteId) {
      const rows = await client
        .select()
        .from(domains)
        .where(eq(domains.siteId, siteId))
        .orderBy(asc(domains.createdAt));
      return rows.map(mapDomain);
    },
    async getByHostname(hostname) {
      const rows = await client.select().from(domains).where(eq(domains.hostname, hostname)).limit(1);
      return rows[0] ? mapDomain(rows[0]) : null;
    },
    async insert(record) {
      try {
        await client.insert(domains).values({
          id: record.id,
          siteId: record.siteId,
          hostname: record.hostname,
          type: record.type,
          status: record.status,
          cloudflareCustomHostnameId: record.cloudflareCustomHostnameId,
          verificationErrorsJson: record.verificationErrorsJson,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      } catch (error) {
        // Drizzle wraps D1 errors; the UNIQUE text lives on the cause chain, not .message.
        const chain: string[] = [];
        let cur: unknown = error;
        while (cur instanceof Error) {
          chain.push(cur.message);
          cur = cur.cause;
        }
        if (/UNIQUE/i.test(chain.join("\n"))) {
          throw new ConflictError("That domain is already connected to another blog.");
        }
        throw error;
      }
    },
    async reclaimStale(hostname, staleBeforeUpdatedAt) {
      const result = await client
        .delete(domains)
        .where(
          and(
            eq(domains.hostname, hostname),
            eq(domains.type, "custom"),
            inArray(domains.status, ["pending", "failed"]),
            lte(domains.updatedAt, staleBeforeUpdatedAt),
          ),
        )
        .run();
      return result.meta.changes ?? 0;
    },
    async deleteCustomForSite(id, siteId) {
      const result = await client
        .delete(domains)
        .where(and(eq(domains.id, id), eq(domains.siteId, siteId), eq(domains.type, "custom")))
        .run();
      return result.meta.changes ?? 0;
    },
    async setProvisioning(id, siteId, patch) {
      await client
        .update(domains)
        .set({
          cloudflareCustomHostnameId: patch.cloudflareCustomHostnameId,
          status: patch.status,
          verificationErrorsJson: patch.verificationErrorsJson,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(and(eq(domains.id, id), eq(domains.siteId, siteId), eq(domains.type, "custom")))
        .run();
    },
  };
}
