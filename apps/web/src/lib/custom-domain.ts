/**
 * Pure translation of a Cloudflare for SaaS `custom_hostname` payload into our
 * domain status. Kept free of `cloudflare:workers` imports so it is node-unit-testable;
 * the API client that fetches the payload lives in the server layer and imports this.
 *
 * A domain is `active` ONLY when both the hostname and its SSL certificate are active -
 * never mark a half-issued cert active (it would serve TLS errors). Terminal-bad states
 * map to `failed`; everything else is `pending` and carries any verification errors.
 */

/** The subset of the CF `custom_hostnames` GET payload we read. */
export type CloudflareCustomHostname = {
  id?: string;
  hostname?: string;
  status?: string;
  verification_errors?: string[];
  ssl?: {
    status?: string;
    validation_errors?: Array<{ message?: string }>;
  };
};

export type MappedDomainStatus = {
  status: "pending" | "active" | "failed";
  verificationErrors: string[];
};

// Terminal-bad hostname states (CF will not progress these without user action).
const FAILED_HOSTNAME_STATUS: Record<string, true> = {
  blocked: true,
  moved: true,
  deleted: true,
  pending_deletion: true,
  deactivated: true,
};
// Terminal-bad SSL states.
const FAILED_SSL_STATUS: Record<string, true> = {
  expired: true,
  deleted: true,
  deactivated: true,
  validation_timed_out: true,
  issuance_timed_out: true,
};

export function mapCustomHostnameStatus(payload: CloudflareCustomHostname): MappedDomainStatus {
  const verificationErrors: string[] = [];
  for (const message of payload.verification_errors ?? []) {
    if (typeof message === "string" && message.trim()) verificationErrors.push(message);
  }
  for (const error of payload.ssl?.validation_errors ?? []) {
    if (error?.message && error.message.trim()) verificationErrors.push(error.message);
  }

  const hostnameStatus = payload.status ?? "";
  const sslStatus = payload.ssl?.status ?? "";

  if (FAILED_HOSTNAME_STATUS[hostnameStatus] || FAILED_SSL_STATUS[sslStatus]) {
    return { status: "failed", verificationErrors };
  }
  if (hostnameStatus === "active" && sslStatus === "active") {
    return { status: "active", verificationErrors: [] };
  }
  return { status: "pending", verificationErrors };
}
