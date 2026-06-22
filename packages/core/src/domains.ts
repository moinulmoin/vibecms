/**
 * Custom-domain hostname validation (pure; no infra deps).
 *
 * This is the SOLE gate that stops a tenant from claiming a platform hostname
 * (the apex or any `*.platformZone` subdomain) as their "custom" domain. Because
 * `*.platformZone` DNS wildcards to the worker for the subdomain product, a
 * `custom` domain row for a platform host would otherwise serve. resolveSite adds
 * defense-in-depth, but validation is the primary boundary - keep it strict.
 */

export type CustomDomainStatus = "pending" | "active" | "failed" | "disabled";

export type HostnameValidationOptions = {
  /** Dashboard/app host, e.g. `app.vibecms.dev` (never a user blog host). */
  appHost: string;
  /** Platform apex zone, e.g. `vibecms.dev`. Its apex and every subdomain are reserved. */
  platformZone: string;
};

export type HostnameValidationResult = { ok: true; hostname: string } | { ok: false; error: string };

// One DNS label: 1-63 chars, alphanumeric, internal hyphens only (covers xn-- punycode).
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate + normalize a user-supplied custom hostname. Returns the lowercased,
 * trailing-dot-stripped hostname on success, or a human-readable error.
 */
export function validateCustomHostname(input: string, opts: HostnameValidationOptions): HostnameValidationResult {
  const hostname = input.trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return { ok: false, error: "Enter a domain." };
  if (hostname.length > 253) return { ok: false, error: "Domain is too long." };
  if (hostname.includes("*")) return { ok: false, error: "Wildcard domains are not supported." };
  // Reject anything that is not a bare hostname (scheme, port, path, whitespace).
  if (/[/:\s]/.test(hostname)) return { ok: false, error: "Enter a bare domain, for example blog.example.com." };
  // Reject IPv4 literals (IPv6 already rejected by the ':' check above).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return { ok: false, error: "Enter a domain, not an IP address." };

  const labels = hostname.split(".");
  if (labels.length < 2) return { ok: false, error: "Enter a fully qualified domain, for example blog.example.com." };
  if (!labels.every((label) => LABEL.test(label))) return { ok: false, error: "Domain contains invalid characters." };
  // A purely numeric TLD is never valid.
  if (/^\d+$/.test(labels[labels.length - 1])) return { ok: false, error: "Enter a valid domain." };

  const appHost = opts.appHost.trim().toLowerCase();
  const zone = opts.platformZone.trim().toLowerCase();
  if (hostname === "localhost") return { ok: false, error: "That domain is reserved." };
  if (appHost && hostname === appHost) return { ok: false, error: "That domain is reserved." };
  if (zone && (hostname === zone || hostname.endsWith(`.${zone}`)))
    return { ok: false, error: "That domain belongs to the platform. Use your own domain instead." };

  return { ok: true, hostname };
}

/** A row in the `domains` table (camelCase domain entity). */
export type DomainRecord = {
  id: string;
  siteId: string;
  hostname: string;
  type: "default" | "custom";
  status: CustomDomainStatus;
  cloudflareCustomHostnameId: string | null;
  verificationErrorsJson: string | null;
  createdAt: number;
  updatedAt: number;
};
