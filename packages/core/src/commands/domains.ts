import { type DomainRecord, validateCustomHostname } from "../domains";
import { BillingRequiredError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";

export type DomainRepository = {
  listBySite(siteId: string): Promise<DomainRecord[]>;
  getByHostname(hostname: string): Promise<DomainRecord | null>;
  /** Insert a domain row. MUST throw ConflictError if the hostname UNIQUE constraint fails. */
  insert(record: DomainRecord): Promise<void>;
  /**
   * Conditionally delete an abandoned row for `hostname`: only when it is still
   * pending/failed and was last touched at or before `staleBeforeUpdatedAt`. Returns
   * rows removed - 0 means it changed under us (e.g. just verified), so do not reclaim.
   */
  reclaimStale(hostname: string, staleBeforeUpdatedAt: number): Promise<number>;
  /** Delete a CUSTOM domain by id, scoped to its site. Returns rows removed (never the default subdomain). */
  deleteCustomForSite(id: string, siteId: string): Promise<number>;
  /** Persist Cloudflare provisioning state (custom-hostname id + status + verification errors). */
  setProvisioning(
    id: string,
    siteId: string,
    patch: { cloudflareCustomHostnameId: string | null; status: DomainRecord["status"]; verificationErrorsJson: string | null },
  ): Promise<void>;
};

// A never-verified row older than this is treated as abandoned and may be reclaimed by
// the real owner, so a squatter cannot permanently hold a hostname via the UNIQUE constraint.
const DEFAULT_STALE_TTL_SECONDS = 72 * 60 * 60; // 3 days

export type AddCustomDomainInput = {
  siteId: string;
  hostname: string;
  /** Caller-computed: the acting user is a human workspace owner. */
  isOwner: boolean;
  /** Caller-computed: the workspace has an active subscription. */
  isPaid: boolean;
  appHost: string;
  platformZone: string;
  staleTtlSeconds?: number;
  now?: number;
};

export async function addCustomDomain(repo: DomainRepository, input: AddCustomDomainInput): Promise<{ record: DomainRecord; reclaimedCfHostnameId: string | null }> {
  if (!input.isOwner) throw new ForbiddenError("Only workspace owners can manage domains.");
  if (!input.isPaid) throw new BillingRequiredError("Custom domains require an active subscription.");

  const validation = validateCustomHostname(input.hostname, { appHost: input.appHost, platformZone: input.platformZone });
  if (!validation.ok) throw new ValidationError(validation.error);
  const hostname = validation.hostname;

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const staleBefore = now - (input.staleTtlSeconds ?? DEFAULT_STALE_TTL_SECONDS);
  let reclaimedCfHostnameId: string | null = null;

  const existing = await repo.getByHostname(hostname);
  if (existing) {
    if (existing.siteId === input.siteId) return { record: existing, reclaimedCfHostnameId: null }; // idempotent: already connected to this site
    const reclaimable =
      (existing.status === "pending" || existing.status === "failed") && existing.updatedAt <= staleBefore;
    if (!reclaimable) throw new ConflictError("That domain is already connected to another blog.");
    // Conditional delete closes the TOCTOU window: if the row was verified between the read
    // and now, 0 rows are removed and we must not steal it.
    const reclaimed = await repo.reclaimStale(hostname, staleBefore);
    if (reclaimed === 0) throw new ConflictError("That domain is already connected to another blog.");
    reclaimedCfHostnameId = existing.cloudflareCustomHostnameId;
  }

  const record: DomainRecord = {
    id: crypto.randomUUID(),
    siteId: input.siteId,
    hostname,
    type: "custom",
    status: "pending",
    cloudflareCustomHostnameId: null,
    verificationErrorsJson: null,
    createdAt: now,
    updatedAt: now,
  };
  await repo.insert(record); // throws ConflictError on a concurrent UNIQUE claim
  return { record, reclaimedCfHostnameId };
}

export async function listCustomDomains(repo: DomainRepository, siteId: string): Promise<DomainRecord[]> {
  const rows = await repo.listBySite(siteId);
  return rows.filter((row) => row.type === "custom");
}

export type RemoveCustomDomainInput = { siteId: string; domainId: string; isOwner: boolean };

export async function removeCustomDomain(repo: DomainRepository, input: RemoveCustomDomainInput): Promise<void> {
  if (!input.isOwner) throw new ForbiddenError("Only workspace owners can manage domains.");
  const removed = await repo.deleteCustomForSite(input.domainId, input.siteId);
  if (removed === 0) throw new NotFoundError("Domain not found.");
}
