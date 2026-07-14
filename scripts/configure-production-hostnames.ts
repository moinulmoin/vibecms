export {};

const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const zoneName = process.env.CLOUDFLARE_ZONE_NAME?.trim() || "vibecms.dev";
const cnameTarget = `cname.${zoneName}`;

if (!zoneId) throw new Error("CLOUDFLARE_ZONE_ID is required");
if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required");

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result: T;
}

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json()) as CloudflareEnvelope<T>;
  if (!response.ok || !body.success) {
    const detail = body.errors?.map((error) => error.message).filter(Boolean).join(", ");
    throw new Error(`Cloudflare API ${response.status}: ${detail || "request failed"}`);
  }
  return body.result;
}

interface DnsRecord {
  id: string;
}

async function upsertDnsRecord(record: {
  type: "A" | "CNAME";
  name: string;
  content: string;
  comment: string;
}): Promise<void> {
  const existing = await cloudflare<DnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`,
  );
  const body = JSON.stringify({ ...record, proxied: true, ttl: 1 });
  if (existing[0]) {
    await cloudflare(`/zones/${zoneId}/dns_records/${existing[0].id}`, { method: "PUT", body });
  } else {
    await cloudflare(`/zones/${zoneId}/dns_records`, { method: "POST", body });
  }
}

await upsertDnsRecord({
  type: "A",
  name: `*.${zoneName}`,
  content: "192.0.2.1",
  comment: "VibeCMS tenant subdomain routing",
});
await upsertDnsRecord({
  type: "CNAME",
  name: cnameTarget,
  content: zoneName,
  comment: "VibeCMS Cloudflare for SaaS fallback origin",
});

await cloudflare(`/zones/${zoneId}/custom_hostnames/fallback_origin`, {
  method: "PUT",
  body: JSON.stringify({ origin: cnameTarget }),
});

console.log(`Configured *.${zoneName}, ${cnameTarget}, and the Cloudflare for SaaS fallback origin`);
