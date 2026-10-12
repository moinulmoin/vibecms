/**
 * Server-side agent fetch counting (plans/023 §1/§3): one Analytics Engine
 * `agent_fetch` point per tenant request that is clearly not a person — a
 * known-agent UA, a Markdown representation request, an agent surface
 * (llms/feed/sitemap/robots), or a `Signature-Agent` header. Writes run inside
 * `waitUntil` after the response is decided; they never delay or change it.
 */
import { createDataAccess } from "@vc/db";
import {
  agentForUserAgent,
  UNKNOWN_AGENT_ID,
  type AgentCategory,
} from "@vc/config/agents";
import type { PublicRuntimeEnv } from "../env";
import { analyticsConfigured } from "./public-analytics";
import { isMarketingHost, isReadableTenantPostSlug, markdownRequested } from "./public-blog";
import type { PublicLocation } from "./public-location";

// Infra/tooling paths never count: the proxy envelope, assets, our API
// surfaces, docs, previews, media, OG images, and health checks. `docs/` and
// `internal/` match descendants only — bare `/docs` and `/internal` are
// readable legacy tenant post slugs (isReadableTenantPostSlug).
const AGENT_FETCH_SKIP_RE =
  /^\/(?:_vc(?:\/|$)|_astro(?:\/|$)|internal\/|api(?:\/|$)|docs\/|preview(?:\/|$)|media-assets(?:\/|$)|og(?:[./]|$)|\.well-known(?:\/|$)|favicon\.|__vc-health)/;

export type AgentFetchResource =
  | "post"
  | "index"
  | "tag"
  | "search"
  | "llms"
  | "feed"
  | "sitemap"
  | "robots"
  | "other";

export type AgentFetchRepresentation = "html" | "markdown" | "xml" | "text";

export type AgentFetchSignal = {
  resource: AgentFetchResource;
  representation: AgentFetchRepresentation;
  /** Published-post slug when `resource === "post"`; resolved to an id before write. */
  postSlug?: string;
  agentId: string;
  category: AgentCategory;
  signed: boolean;
};

function requestHost(request: Request): string {
  return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
}

/**
 * Classify a tenant request. Returns null when nothing marks it as an agent:
 * the same function is the filter deciding whether a point is written at all.
 */
export function agentFetchSignal(request: Request, publicPath: string): AgentFetchSignal | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (AGENT_FETCH_SKIP_RE.test(publicPath)) return null;

  const entry = agentForUserAgent(request.headers.get("user-agent"));
  const signed = Boolean(request.headers.get("signature-agent"));
  const markdown = publicPath.endsWith(".md") || markdownRequested(request);
  const cleanPath = publicPath.endsWith(".md") ? publicPath.slice(0, -3) : publicPath;

  let resource: AgentFetchResource = "other";
  let representation: AgentFetchRepresentation = "html";
  let postSlug: string | undefined;
  if (cleanPath === "/llms.txt" || cleanPath === "/llms-full.txt") {
    resource = "llms";
    representation = "text";
  } else if (cleanPath === "/feed.xml") {
    resource = "feed";
    representation = "xml";
  } else if (cleanPath === "/sitemap.xml") {
    resource = "sitemap";
    representation = "xml";
  } else if (cleanPath === "/robots.txt") {
    resource = "robots";
    representation = "text";
  } else if (cleanPath === "/") {
    resource = new URL(request.url).searchParams.get("q")?.trim() ? "search" : "index";
  } else if (cleanPath.startsWith("/tag/") && cleanPath.length > 5) {
    resource = "tag";
  } else {
    const slug = cleanPath.slice(1);
    if (cleanPath.length > 1 && !slug.includes("/") && isReadableTenantPostSlug(slug)) {
      resource = "post";
      postSlug = slug;
    }
  }
  if (markdown) representation = "markdown";

  // Agent surfaces (llms/feed/sitemap/robots) count regardless of UA: they
  // exist for machines, and a human clicking them is the exception.
  const agentSurface = resource === "llms" || resource === "feed" || resource === "sitemap" || resource === "robots";
  if (!entry && !markdown && !agentSurface && !signed) return null;

  return {
    resource,
    representation,
    postSlug,
    agentId: entry?.id ?? UNKNOWN_AGENT_ID,
    category: entry?.category ?? "unknown-agent",
    signed,
  };
}

export type AgentFetchEvent = {
  siteId: string;
  postId: string;
  host: string;
  signal: AgentFetchSignal;
};

/** blob layout (plans/023 §3): host is last so readers can ignore it positionally. */
export function writeAgentFetch(dataset: AnalyticsEngineDataset, event: AgentFetchEvent): void {
  dataset.writeDataPoint({
    indexes: [event.siteId],
    blobs: [
      "agent_fetch",
      event.postId,
      event.signal.resource,
      event.signal.agentId,
      event.signal.category,
      event.signal.representation,
      event.signal.signed ? "1" : "",
      event.host,
    ],
    doubles: [1],
  });
}

/**
 * Record one `agent_fetch` for a decided response. Classification is cheap and
 * synchronous; site/post resolution (D1) happens inside the returned job so it
 * can be deferred with `waitUntil`. The returned promise never rejects — the
 * caller may ignore it or await it in tests.
 */
export function recordAgentFetch(args: {
  request: Request;
  response: Response;
  /** Blog-relative path (already stripped of the `/_vc/p/<id>` proxy envelope). */
  publicPath: string;
  location: PublicLocation;
  env: Env;
  runtime: PublicRuntimeEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<void> | null {
  const { request, response, env, runtime } = args;
  if (response.status !== 200 && response.status !== 304) return null;
  if (!runtime.selfHosted && isMarketingHost(request, runtime)) return null;
  // Env.ANALYTICS is typed always-present; self-host installs may omit the
  // binding at runtime, so the truthiness check stays.
  const dataset: AnalyticsEngineDataset | undefined = env.ANALYTICS;
  if (!dataset) return null;
  // Self-host writes only when the whole analytics env is configured — the
  // API Worker needs the query vars to read the dataset back (plans/023 §5).
  if (runtime.selfHosted && !analyticsConfigured(env)) return null;
  const signal = agentFetchSignal(request, args.publicPath);
  if (!signal) return null;

  const job = (async () => {
    try {
      const data = createDataAccess(env.DB);
      const site = runtime.selfHosted
        ? await data.publicBlog.resolveSingleSite()
        : await data.publicBlog.resolveSiteByHost(requestHost(request));
      if (!site) return;
      const postId = signal.postSlug
        ? await data.publicBlog.getPublishedPostId(site.id, signal.postSlug, Math.floor(Date.now() / 1000))
        : null;
      writeAgentFetch(dataset, {
        siteId: site.id,
        postId: postId ?? "",
        host: new URL(args.location.origin).hostname,
        signal,
      });
    } catch (error) {
      console.warn(JSON.stringify({ level: "warn", event: "agent_fetch_write_failed", error: String(error) }));
    }
  })();
  args.waitUntil?.(job);
  return job;
}
