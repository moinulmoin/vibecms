import { BillingRequiredError, ConflictError, normalizeRedirectPath, RESERVED_ROOT_SLUGS, requireScope, ValidationError } from "@vc/core";
import { FREE_TIER } from "@vc/config";
import { countSiteRedirects, createDataAccess, deleteSiteRedirects, listSiteRedirects, setSiteRedirects } from "@vc/db";
import { env } from "cloudflare:workers";
import { resolveEffectiveEntitlementForSite } from "./effective-entitlement";
import { scheduleRedirectPurge } from "./purge-scheduler";
import type { OperationContext } from "./operations";

const PAID_REDIRECT_LIMIT = 5000;

async function planLimit(siteId: string) {
  return (await resolveEffectiveEntitlementForSite(siteId)).effective ? PAID_REDIRECT_LIMIT : FREE_TIER.redirects;
}

async function purge(siteId: string, paths: string[]) {
  const site = await createDataAccess(env.DB).sites.getCurrentSite(siteId);
  if (site) scheduleRedirectPurge(siteId, site.slug, paths);
}

export async function listRedirectsOp(ctx: OperationContext, input: { offset?: number; limit?: number }) {
  requireScope(ctx.actor, "sites:read");
  const [limit, total, rows] = await Promise.all([
    planLimit(ctx.siteId), countSiteRedirects(env.DB, ctx.siteId),
    listSiteRedirects(env.DB, ctx.siteId, input.limit ?? 100, input.offset ?? 0),
  ]);
  return { redirects: rows.map((row) => ({ from: row.fromPath, to: row.toPath, createdAt: row.createdAt, updatedAt: row.updatedAt })), total, limit };
}

export async function setRedirectsOp(ctx: OperationContext, input: { redirects: { from: string; to: string }[] }) {
  requireScope(ctx.actor, "site:write");
  const errors: string[] = [];
  const seen = new Set<string>();
  const items = input.redirects.map((item, index) => {
    const from = normalizeRedirectPath(item.from);
    const to = item.to.startsWith("//") ? null : normalizeRedirectPath(item.to, { preserveCase: true, allowRoot: true });
    if (!from) errors.push(`redirects[${index}].from: invalid path`);
    else if (RESERVED_ROOT_SLUGS.has(from.slice(1).split("/")[0]!)) errors.push(`redirects[${index}].from: reserved system route`);
    else if (seen.has(from)) errors.push(`redirects[${index}].from: duplicate source`);
    if (from) seen.add(from);
    if (!to) errors.push(`redirects[${index}].to: invalid path`);
    if (from && to && from === to.toLowerCase()) errors.push(`redirects[${index}].to: source and destination must differ`);
    return { from: from ?? "", to: to ?? "", index };
  });
  if (errors.length) throw new ValidationError(errors.join("; "));
  const limit = await planLimit(ctx.siteId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await listSiteRedirects(env.DB, ctx.siteId, PAID_REDIRECT_LIMIT + 1, 0);
    const before = new Map(existing.map((row) => [row.fromPath, row.toPath]));
    const final = new Map(before);
    for (const item of items) final.set(item.from, item.to);
    const chainErrors = new Set<string>();
    for (const [from, to] of final) {
      const target = to.toLowerCase();
      if (!final.has(target)) continue;
      for (const item of items) {
        if (item.from === from || item.from === target) chainErrors.add(`redirects[${item.index}]: redirect chains and loops are not allowed`);
      }
    }
    if (chainErrors.size) throw new ValidationError([...chainErrors].join("; "));
    if (final.size > limit) {
      if (limit === FREE_TIER.redirects) throw new BillingRequiredError(`Free plan allows up to ${limit} redirects per site.`);
      throw new ValidationError(`A site can have at most ${limit} redirects.`);
    }
    const results = items.map(({ from, to }) => ({ from, to, status: !before.has(from) ? "created" as const : before.get(from) === to ? "unchanged" as const : "updated" as const }));
    const changes = results.filter((item) => item.status !== "unchanged");
    const added = changes.filter((item) => item.status === "created").length;
    const updated = changes.length - added;
    const summary = added && updated ? `Added ${added} redirects, updated ${updated} redirects` : added ? `Added ${added} redirects` : `Updated ${updated} redirects`;
    if (await setSiteRedirects(env.DB, ctx.siteId, ctx.actor, existing, changes, summary)) {
      if (changes.length) await purge(ctx.siteId, changes.map((item) => item.from));
      return { results, total: final.size, limit };
    }
  }
  throw new ConflictError("Redirects changed concurrently. Read them and retry.");
}

export async function deleteRedirectsOp(ctx: OperationContext, input: { from: string[] }) {
  requireScope(ctx.actor, "site:write");
  const errors: string[] = [];
  const paths = input.from.map((value, index) => {
    const path = normalizeRedirectPath(value);
    if (!path) errors.push(`from[${index}]: invalid path`);
    return path ?? "";
  });
  if (errors.length) throw new ValidationError(errors.join("; "));
  const deleted = await deleteSiteRedirects(env.DB, ctx.siteId, ctx.actor, paths);
  if (deleted) await purge(ctx.siteId, paths);
  return { deleted };
}
