import type { APIRoute } from "astro";
import { agentForUserAgent } from "@vc/config/agents";
import { isPublicBlogPaused, loadPublicPostByHost } from "../../../server/public-blog";
import {
  analyticsConfigured,
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
  const worker = workerEnv(context);
  // Self-host records only when the full analytics env is configured
  // (ANALYTICS binding + account/dataset/token query vars, plans/023 §5);
  // otherwise the beacon silently drops views like today.
  if ((runtime.selfHosted && !analyticsConfigured(worker)) || privacySignalEnabled(context.request)) {
    return emptyResponse();
  }
  // server-side agent_fetch point already counts them.
  if (agentForUserAgent(context.request.headers.get("user-agent"))) return emptyResponse();
  const requestUrl = new URL(context.request.url);
  // Proxied blogs run on the customer origin; the beacon posts same-origin
  // there, so the Origin check compares against the location, not our host.
  const expectedOrigin = context.locals.publicLocation?.origin ?? requestUrl.origin;
  if (context.request.headers.get("origin") !== expectedOrigin) {
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

  const blog = await loadPublicPostByHost(publicDb(context), context.request, body.slug, runtime, context.locals.publicLocation);
  if (!blog) return emptyResponse();
  // A paused managed blog is not serving: the beacon records nothing.
  if (isPublicBlogPaused(blog)) return emptyResponse();
   if (!blog.indexable) return emptyResponse();

  writePageView(worker.ANALYTICS, {
    siteId: blog.site.id,
    postId: blog.post.id,
    postSlug: blog.post.slug,
    referrerHost: normalizeReferrerHost(body.referrerHost, new URL(expectedOrigin).hostname),
  });
  return emptyResponse();
};
