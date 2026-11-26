import type { PublicRuntimeEnv } from "../env";
import { isMarketingHost } from "./public-blog-data";

/**
 * The IndexNow key file: `/<key>.txt` (blog-relative, so a subpath blog
 * serves it under its base path) answers the configured key as plain text on
 * every blog host. Null for any other path, any other method, the product's
 * own hosts, or when no key is configured.
 */
export function indexNowKeyFile(request: Request, pathname: string, env: PublicRuntimeEnv): Response | null {
  const key = env.indexNowKey;
  if (!key || pathname !== `/${key}.txt`) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!env.selfHosted && isMarketingHost(request, env)) return null;
  return new Response(request.method === "HEAD" ? null : key, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-robots-tag": "noindex",
    },
  });
}
