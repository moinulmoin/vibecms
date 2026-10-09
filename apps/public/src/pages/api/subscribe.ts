import type { APIRoute } from "astro";
import { API_BINDING_HOSTNAME } from "@vc/config";
import { apiBinding } from "../../server/runtime";

/**
 * Delegates newsletter writes to the API Worker service binding (no
 * TOKEN_PEPPER on public). On proxied subpath blogs the client IP arrives as
 * X-Forwarded-For (CF-Connecting-IP is the proxy's edge); we hand the first
 * hop to the API on a dedicated header it only trusts from this binding.
 * That first hop is client-influenced — a caller can send an arbitrary
 * X-Forwarded-For, or none — so the API uses it only for per-visitor
 * fairness. Every proxied request is marked with `x-vc-proxied` (whether or
 * not it carried an IP) so the API's proxied cap can't be skipped by leaving
 * the header out. Client-sent copies of both headers are always stripped.
 */
export const POST: APIRoute = async (context) => {
  const url = new URL("/api/subscribe", `https://${API_BINDING_HOSTNAME}`);
  const headers = new Headers(context.request.headers);
  headers.delete("x-vc-client-ip");
  headers.delete("x-vc-proxied");
  if (context.locals.publicLocation?.proxied) {
    headers.set("x-vc-proxied", "1");
    const clientIp = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (clientIp) headers.set("x-vc-client-ip", clientIp);
  }
  const upstream = new Request(url, {
    method: "POST",
    headers,
    body: context.request.body,
  });
  return apiBinding(context).fetch(upstream);
};
