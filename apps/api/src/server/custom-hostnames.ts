/**
 * Cloudflare for SaaS custom_hostnames client (PROD-gated).
 *
 * Inert until CLOUDFLARE_ZONE_ID + CUSTOM_HOSTNAME_API_TOKEN are set (a CF token scoped
 * to SSL and Certificates: Edit). On dev these are absent, so every call returns null/no-op
 * and the add flow simply leaves the domain `pending`. See plans/PROD-LAUNCH.md for the
 * full Cloudflare for SaaS setup (enable SaaS on the zone, fallback origin, CNAME target).
 *
 * SSL method `http`: once the customer CNAMEs their hostname to CUSTOM_HOSTNAME_CNAME_TARGET,
 * Cloudflare issues the certificate via HTTP DV automatically - no TXT record required.
 */
import { env } from 'cloudflare:workers'
import { type CloudflareCustomHostname, mapCustomHostnameStatus, type MappedDomainStatus } from '@/lib/custom-domain'

const CF_API = 'https://api.cloudflare.com/client/v4'
const CF_TIMEOUT_MS = 8_000

type CfConfig = { zoneId: string; token: string }
type CfEnvelope = { success?: boolean; result?: CloudflareCustomHostname }

function cfConfig(): CfConfig | null {
  const zoneId = env.CLOUDFLARE_ZONE_ID
  const token = env.CUSTOM_HOSTNAME_API_TOKEN
  if (!zoneId || !token) return null
  return { zoneId, token }
}

/** True when Cloudflare for SaaS custom-hostname provisioning is configured (prod). */
export function customHostnameProvisioningEnabled(): boolean {
  return cfConfig() !== null
}

/** The CNAME target customers point their domain at (the SaaS fallback origin). */
export function customHostnameCnameTarget(): string | null {
  return env.CUSTOM_HOSTNAME_CNAME_TARGET?.trim() || null
}

export async function createCustomHostname(hostname: string): Promise<CloudflareCustomHostname | null> {
  const cfg = cfConfig()
  if (!cfg) return null
  try {
    const res = await fetch(`${CF_API}/zones/${cfg.zoneId}/custom_hostnames`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, ssl: { method: 'http', type: 'dv' } }),
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    })
    const json = (await res.json()) as CfEnvelope
    if (!res.ok || !json.success || !json.result?.id) return null
    return json.result
  } catch {
    return null
  }
}

export async function getCustomHostname(id: string): Promise<CloudflareCustomHostname | null> {
  const cfg = cfConfig()
  if (!cfg) return null
  try {
    const res = await fetch(`${CF_API}/zones/${cfg.zoneId}/custom_hostnames/${id}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    })
    const json = (await res.json()) as CfEnvelope
    if (!res.ok || !json.success || !json.result) return null
    return json.result
  } catch {
    return null
  }
}

export async function deleteCustomHostname(id: string): Promise<void> {
  const cfg = cfConfig()
  if (!cfg) return
  try {
    await fetch(`${CF_API}/zones/${cfg.zoneId}/custom_hostnames/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    })
  } catch {
    // fail-open: best-effort cleanup; a stale CF hostname does not affect our row.
  }
}

/** Fetch + map the live status of a provisioned hostname (null when CF is off or unreachable). */
export async function refreshCustomHostnameStatus(id: string): Promise<MappedDomainStatus | null> {
  const payload = await getCustomHostname(id)
  return payload ? mapCustomHostnameStatus(payload) : null
}
