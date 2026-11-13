/**
 * The operator's suspend and clear statements (docs/blog-suspension.md).
 * `wrangler d1 execute --command` takes no bound parameters, so the operator
 * script runs these literal statements; inputs are validated first and the
 * reason is quoted as an SQLite string literal. Tests run the same text.
 *
 * Suspension touches only the three `sites.suspen*` columns: never
 * `updated_at` (dashboard edits use it as their revision), never the
 * AutoSEOPilot managed binding or its claim clock.
 */

const SITE_REF_RE = /^[A-Za-z0-9_-]{1,64}$/;
const REASON_MAX_LENGTH = 500;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export class SuspensionInputError extends Error {}

function siteRef(value: string): string {
  if (!SITE_REF_RE.test(value)) throw new SuspensionInputError("Site must be a site id or blog address (letters, numbers, - and _).");
  return value;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Finds the site by id or by blog address (slug), with its current suspension. */
export function findSiteForSuspensionSql(site: string): string {
  const ref = quote(siteRef(site));
  return `SELECT id, slug, name, suspended_at, suspension_reason, suspension_notified_at FROM sites WHERE id = ${ref} OR slug = ${ref} LIMIT 2`;
}

/** Suspends one site that is not suspended yet; the owner email goes out on the next 15-minute cron. */
export function suspendSiteSql(siteId: string, reason: string, now: number): string {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > REASON_MAX_LENGTH || CONTROL_RE.test(trimmed)) {
    throw new SuspensionInputError(`Reason is required: one line, at most ${REASON_MAX_LENGTH} characters. The owner reads it in the email.`);
  }
  if (!Number.isInteger(now) || now <= 0) throw new SuspensionInputError("now must be epoch seconds.");
  return `UPDATE sites SET suspended_at = ${now}, suspension_reason = ${quote(trimmed)}, suspension_notified_at = NULL WHERE id = ${quote(siteRef(siteId))} AND suspended_at IS NULL`;
}

/** Clears a suspension: every address serves again and writes are accepted. */
export function clearSiteSuspensionSql(siteId: string): string {
  return `UPDATE sites SET suspended_at = NULL, suspension_reason = NULL, suspension_notified_at = NULL WHERE id = ${quote(siteRef(siteId))} AND suspended_at IS NOT NULL`;
}
