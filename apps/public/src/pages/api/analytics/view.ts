import { hasActiveSubscription } from "@vc/config";

import type { APIRoute } from "astro";
import { loadPublicPostByHost } from "../../../server/public-blog";
import {
  normalizeReferrerHost,
  privacySignalEnabled,
  writePageView,
} from "../../../server/public-analytics";
import { publicDb, publicRuntimeEnv, workerEnv } from "../../../server/runtime";

const MAX_BODY_BYTES = 1024;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function emptyResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export const POST: APIRoute = async (context) => {
  const runtime = publicRuntimeEnv(context);
  if (runtime.selfHosted || privacySignalEnabled(context.request)) return emptyResponse();

  const requestUrl = new URL(context.request.url);
  if (context.request.headers.get("origin") !== requestUrl.origin) {
    return new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }

  const contentLength = Number(context.request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413, headers: { "cache-control": "no-store" } });
  }

  let body: { slug?: unknown; referrerHost?: unknown };
  try {
    const text = await context.request.text();
    if (text.length > MAX_BODY_BYTES) throw new Error("payload_too_large");
    body = JSON.parse(text) as { slug?: unknown; referrerHost?: unknown };
  } catch {
    return new Response("Invalid request", { status: 400, headers: { "cache-control": "no-store" } });
  }

  if (typeof body.slug !== "string" || !SLUG_RE.test(body.slug)) {
    return new Response("Invalid request", { status: 400, headers: { "cache-control": "no-store" } });
  }

  const blog = await loadPublicPostByHost(publicDb(context), context.request, body.slug, runtime);
  if (!blog) return emptyResponse();
  if (!hasActiveSubscription(blog.site.billing_status)) return emptyResponse();


  writePageView(workerEnv(context).ANALYTICS, {
    siteId: blog.site.id,
    postId: blog.post.id,
    postSlug: blog.post.slug,
    referrerHost: normalizeReferrerHost(body.referrerHost, requestUrl.hostname),
  });
  return emptyResponse();
};
