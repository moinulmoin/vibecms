import { and, asc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
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
    activatedAt: row.activatedAt,
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
    async getExclusiveByHostname(hostname) {
      const rows = await client
        .select()
        .from(domains)
        .where(and(eq(domains.hostname, hostname), ne(domains.type, "subpath")))
        .limit(1);
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
          activatedAt: record.activatedAt,
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
        activatedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        // One subpath row per site: delete-then-insert in a single batch keeps
        // the replace atomic. Pending claims on the same hostname coexist —
        // hostname uniqueness now lives in the partial claim indexes (0036).
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
            activatedAt: record.activatedAt,
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
    async getSubpathByProxyId(proxyId) {
      const rows = await client
        .select({
          id: domains.id,
          siteId: domains.siteId,
          hostname: domains.hostname,
          basePath: domains.basePath,
          proxyId: domains.proxyId,
          status: domains.status,
        })
        .from(domains)
        .innerJoin(sites, eq(sites.id, domains.siteId))
        .where(and(eq(domains.proxyId, proxyId), eq(domains.type, "subpath"), eq(sites.status, "active")))
        .limit(1);
      const row = rows[0];
      return row ? ({ ...row } satisfies SubpathDomainRow) : null;
    },
    async listActiveSubpaths(limit) {
      const rows = await client
        .select({
          id: domains.id,
          siteId: domains.siteId,
          hostname: domains.hostname,
          basePath: domains.basePath,
          proxyId: domains.proxyId,
          status: domains.status,
        })
        .from(domains)
        .innerJoin(sites, eq(sites.id, domains.siteId))
        .where(and(eq(domains.type, "subpath"), eq(domains.status, "active"), eq(sites.status, "active")))
        // Least-recently-checked first: rows skipped by a previous run's time
        // budget lead the next sweep; never-checked rows (NULL) sort first.
        .orderBy(
          sql`COALESCE(json_extract(${domains.verificationErrorsJson}, '$.checkedAt'), 0)`,
          asc(domains.createdAt),
          asc(domains.id),
        )
        .limit(limit);
      return rows.map((row) => ({ ...row } satisfies SubpathDomainRow));
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
    async deleteStaleSubpathClaims(staleBeforeUpdatedAt, limit) {
      const result = await client.run(sql`
        DELETE FROM domains
        WHERE id IN (
          SELECT id FROM domains
          WHERE type = 'subpath'
            AND status IN ('pending', 'failed')
            AND activated_at IS NULL
            AND updated_at <= ${staleBeforeUpdatedAt}
          LIMIT ${limit}
        )`);
      return result.meta.changes ?? 0;
    },
    async setSubpathStatus(id, siteId, status, verificationErrorsJson) {
      const now = Math.floor(Date.now() / 1000);
      await client
        .update(domains)
        .set({
          status,
          // An active row is live by definition: backfill activated_at so the
          // stale-claim sweep never treats a once-live row as never-active.
          activatedAt: status === "active" ? sql`COALESCE(${domains.activatedAt}, ${now})` : undefined,
          verificationErrorsJson: verificationErrorsJson ?? null,
          updatedAt: now,
        })
        .where(and(eq(domains.id, id), eq(domains.siteId, siteId), eq(domains.type, "subpath")))
        .run();
    },
    async recordSubpathCheck(id, siteId, input) {
      const now = Math.floor(Date.now() / 1000);
      // Rows the activation supersedes. The demote statements carry the same
      // row guard (hostname of the row still matching id+site+proxy id), so a
      // checked row that was rotated/removed mid-probe demotes nothing.
      const demotable = input.checkPassed
        ? await client
            .select({
              id: domains.id,
              siteId: domains.siteId,
              hostname: domains.hostname,
              basePath: domains.basePath,
              proxyId: domains.proxyId,
              status: domains.status,
            })
            .from(domains)
            .where(
              and(
                eq(domains.hostname, sql`(SELECT hostname FROM domains WHERE id = ${id})`),
                ne(domains.id, id),
                eq(domains.type, "subpath"),
                eq(domains.status, "active"),
              ),
            )
        : [];
      const supersededJson = JSON.stringify({
        ok: false,
        errors: [{ code: "superseded", message: "This hostname now points at another blog." }],
        warnings: [],
        checkedAt: now,
      });
      // One D1 batch = one transaction: demote the losers BEFORE activating
      // the winner so idx_domains_subpath_active cannot trip inside it.
      const statements = [
        ...demotable.map((row) =>
          client
            .update(domains)
            .set({ status: "failed" as const, verificationErrorsJson: supersededJson, updatedAt: now })
            .where(
              and(
                eq(domains.id, row.id),
                eq(domains.type, "subpath"),
                eq(domains.status, "active"),
                eq(domains.hostname, sql`(SELECT hostname FROM domains WHERE id = ${id} AND site_id = ${siteId} AND type = 'subpath' AND proxy_id = ${input.proxyId})`),
              ),
            )
            .toSQL(),
        ),
        client
          .update(domains)
          .set({
            // A passing check activates; a failing one demotes only a
            // never-active row (an active row keeps serving — only the owner
            // removes a mount).
            status: sql`CASE WHEN ${input.checkPassed ? 1 : 0} = 1 OR ${domains.status} = 'active' THEN 'active' ELSE 'failed' END`,
            activatedAt: input.checkPassed ? sql`COALESCE(${domains.activatedAt}, ${now})` : undefined,
            verificationErrorsJson: input.verificationErrorsJson,
            updatedAt: now,
          })
          .where(
            and(
              eq(domains.id, id),
              eq(domains.siteId, siteId),
              eq(domains.type, "subpath"),
              eq(domains.proxyId, input.proxyId),
            ),
          )
          .toSQL(),
      ];
      try {
        const prepared = statements.map((q) => db.prepare(q.sql).bind(...q.params));
        const results = await db.batch(prepared);
        const applied = results[results.length - 1]?.meta.changes ?? 0;
        // Only rows THIS batch actually demoted: a racing check can demote a
        // selected loser first, making its statement a 0-change no-op here.
        // Report it anyway and callers would write duplicate
        // site.location.superseded activity and purge an unchanged site.
        const demoted = demotable
          .filter((_, index) => (results[index]?.meta.changes ?? 0) > 0)
          .map((row) => ({ ...row } satisfies SubpathDomainRow));
        return { applied, demoted };
      } catch (error) {
        // Another claim activated on this hostname mid-batch: nothing was
        // applied (the batch is atomic), so the caller re-runs the check.
        if (isUniqueViolation(error)) {
          throw new ConflictError("That hostname was just claimed by another blog. Run the check again.");
        }
        throw error;
      }
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
