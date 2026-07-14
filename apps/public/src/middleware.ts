import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { canonicalHostRedirect } from "./server/canonical-host.server";
import { parsePublicRuntimeEnv } from "./server/public-url";
import { applyPublicSecurityHeaders } from "./server/secure-response-headers";

export const onRequest = defineMiddleware(async (context, next) => {
  const publicEnv = parsePublicRuntimeEnv(env);
  context.locals.publicEnv = publicEnv;

  const redirect = canonicalHostRedirect(context.request, publicEnv);
  if (redirect) {
    applyPublicSecurityHeaders(new URL(context.request.url).pathname, null, redirect.headers);
    return redirect;
  }

  const response = await next();
  const headers = new Headers(response.headers);
  applyPublicSecurityHeaders(new URL(context.request.url).pathname, headers.get("content-type"), headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});