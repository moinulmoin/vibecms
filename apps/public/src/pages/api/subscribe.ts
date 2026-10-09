import type { APIRoute } from "astro";
import { API_BINDING_HOSTNAME } from "@vc/config";
import { apiBinding } from "../../server/runtime";

/**
 * Delegates newsletter writes to the API Worker service binding (no
 * TOKEN_PEPPER on public). On proxied subpath blogs the client IP arrives as
 * X-Forwarded-For (CF-Connecting-IP is the proxy's edge); we hand the first
 * hop to the API on a dedicated header it only trusts from this binding.
 * A client-spoofed x-vc-client-ip is always stripped.
 */
export const POST: APIRoute = async (context) => {
  const url = new URL("/api/subscribe", `https://${API_BINDING_HOSTNAME}`);
  const headers = new Headers(context.request.headers);
  headers.delete("x-vc-client-ip");
  if (context.locals.publicLocation?.proxied) {
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
