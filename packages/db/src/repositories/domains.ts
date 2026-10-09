import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  ConflictError,
  type DomainRecord,
  type DomainRepository,
  type SubpathDomainRow,
} from "@vc/core";
import { createDbClient } from "../client";
import { domains, sites, type DomainRow } from "../schema";

function mapDomain(row: DomainRow): DomainRecord {
  return {
    id: row.id,
    siteId: row.siteId,
    hostname: row.hostname,
    type: row.type === "custom" ? "custom" : row.type === "subpath" ? "subpath" : "default",
    status:
      row.status === "active" || row.status === "failed" || row.status === "disabled" ? row.status : "pending",
    cloudflareCustomHostnameId: row.cloudflareCustomHostnameId,
    verificationErrorsJson: row.verificationErrorsJson,
    basePath: row.basePath,
    proxyId: row.proxyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// 24 random bytes -> 32 base64url chars: non-guessable, not a secret (it only
// identifies proxied traffic), rotatable via rotateProxyId.
function newProxyId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Drizzle wraps D1 errors; the UNIQUE text lives on the cause chain, not .message.
function isUniqueViolation(error: unknown): boolean {
  const chain: string[] = [];
  let cur: unknown = error;
  while (cur instanceof Error) {
    chain.push(cur.message);
    cur = cur.cause;
  }
  return /UNIQUE/i.test(chain.join("\n"));
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
          basePath: record.basePath,
          proxyId: record.proxyId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
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
    async insertSubpath({ siteId, hostname, basePath }) {
      const now = Math.floor(Date.now() / 1000);
      const record: DomainRecord = {
        id: crypto.randomUUID(),
        siteId,
        hostname,
        type: "subpath",
        status: "pending",
        cloudflareCustomHostnameId: null,
        verificationErrorsJson: null,
        basePath,
        proxyId: newProxyId(),
        createdAt: now,
        updatedAt: now,
      };
      try {
        // One subpath row per site: delete-then-insert in a single batch keeps
        // the replace atomic and releases the hostname UNIQUE first.
        await client.batch([
          client.delete(domains).where(and(eq(domains.siteId, siteId), eq(domains.type, "subpath"))),
          client.insert(domains).values({
            id: record.id,
            siteId: record.siteId,
            hostname: record.hostname,
            type: record.type,
            status: record.status,
            cloudflareCustomHostnameId: record.cloudflareCustomHostnameId,
            verificationErrorsJson: record.verificationErrorsJson,
            basePath: record.basePath,
            proxyId: record.proxyId,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          }),
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError("That domain is already connected to another blog.");
        }
        throw error;
      }
      return record;
    },
    async getActiveSubpathByProxyId(proxyId) {
      const rows = await client
        .select({
          id: domains.id,
          siteId: domains.siteId,
          hostname: domains.hostname,
          basePath: domains.basePath,
          proxyId: domains.proxyId,
        })
        .from(domains)
        .innerJoin(sites, eq(sites.id, domains.siteId))
        .where(
          and(
            eq(domains.proxyId, proxyId),
            eq(domains.type, "subpath"),
            eq(domains.status, "active"),
            eq(sites.status, "active"),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? ({ ...row } satisfies SubpathDomainRow) : null;
    },
    async rotateProxyId(id, siteId) {
      const proxyId = newProxyId();
      await client
        .update(domains)
        .set({ proxyId, updatedAt: Math.floor(Date.now() / 1000) })
        .where(and(eq(domains.id, id), eq(domains.siteId, siteId), eq(domains.type, "subpath")))
        .run();
      return proxyId;
    },
    async deleteSubpathForSite(siteId) {
      const result = await client
        .delete(domains)
        .where(and(eq(domains.siteId, siteId), eq(domains.type, "subpath")))
        .run();
      return result.meta.changes ?? 0;
    },
    async setSubpathStatus(id, siteId, status, verificationErrorsJson) {
      await client
        .update(domains)
        .set({ status, verificationErrorsJson: verificationErrorsJson ?? null, updatedAt: Math.floor(Date.now() / 1000) })
        .where(and(eq(domains.id, id), eq(domains.siteId, siteId), eq(domains.type, "subpath")))
        .run();
    },
    async getPrimaryPublicLocation(siteId) {
      // Few rows per site: fetch the active domains and pick by precedence.
      // Deterministic order (oldest first) so a site with multiple active
      // domains of the winning type resolves to a stable location.
      const rows = await client
        .select({ type: domains.type, hostname: domains.hostname, basePath: domains.basePath })
        .from(domains)
        .where(and(eq(domains.siteId, siteId), eq(domains.status, "active")))
        .orderBy(asc(domains.createdAt), asc(domains.id));
      const pick = (type: "subpath" | "custom" | "default") => rows.find((row) => row.type === type);
      const primary = pick("subpath") ?? pick("custom") ?? pick("default");
      if (!primary) return null;
      return { type: primary.type, hostname: primary.hostname, basePath: primary.basePath ?? "" };
    },
  };
}
