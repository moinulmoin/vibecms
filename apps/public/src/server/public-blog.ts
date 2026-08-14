import {
  getPublishedPost,
  isPublicBlogIndexable,
  listPublishedPostSummaries,
  listPublishedPostSummariesByTag,
  searchPublishedPostSummaries,
  resolveSite,
  type PostDetailRow,
  type PostSummaryRow,
  type SiteRow,
} from "./public-blog-data";
import type { PublicRuntimeEnv } from "../env";
import {
  articleCacheTags,
  cachedArticleResponseBelongsToSite,
  conditionalArticleResponse,
  conditionalCachedArticleResponse,
  articleMarkdownAlternateLink,
  contentEtag,
  matchArticleResponseCache,
  publicCacheControlForEntitlement,
  putArticleResponseCache,
} from "./public-blog-cache";
import { publicOrigin } from "./public-url";

export { isMarketingHost } from "./public-blog-data";

export const RESERVED_ROOT_SLUGS = new Set([
  "dashboard",
  "api",
  "blog",
  "login",
  "mcp",
  "media-assets",
  "internal",
  "feed.xml",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
  "llms-full.txt",
  "docs-search.json",
  "docs",
  "__vc-health",
]);

function notFound() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function markdownRequested(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/markdown") || new URL(request.url).searchParams.get("format") === "md";
}

export function stripMarkdownSuffix(slug: string | undefined): { slug: string | undefined; markdown: boolean } {
  if (slug && slug.endsWith(".md")) return { slug: slug.slice(0, -3), markdown: true };
  return { slug, markdown: false };
}

function buildPostMarkdown(post: PostDetailRow, canonicalUrl: string) {
  const description = post.seo_description || post.excerpt || "";
  const date = post.published_at ? new Date(post.published_at * 1000).toISOString() : "";
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(post.tags_json) as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    /* ignore */
  }
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(post.title)}`,
    description ? `description: ${JSON.stringify(description)}` : null,
    date ? `date: ${date}` : null,
    tags.length ? `tags: [${tags.map((tag) => JSON.stringify(tag)).join(", ")}]` : null,
    `canonical: ${canonicalUrl}`,
    post.presentation ? `vibecms: ${JSON.stringify(post.presentation)}` : null,
    "---",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return `${frontmatter}\n\n# ${post.title}\n\n${post.content_markdown}\n`;
}

export type PublicArticleHeaderOptions = {
  markdownAlternateHref?: string;
  etag?: string;
};

export function publicHtmlResponseHeaders(
  site: SiteRow,
  env: PublicRuntimeEnv,
  cacheTags?: string[],
  options?: PublicArticleHeaderOptions,
): Record<string, string> {
  const indexable = isPublicBlogIndexable(site, env);
  const headers: Record<string, string> = {
    "cache-control": publicCacheControlForEntitlement(site.effective_entitlement),
    "content-signal": indexable ? "ai-train=yes, search=yes, ai-input=yes" : "ai-train=no, search=no, ai-input=yes",
  };
  if (options?.markdownAlternateHref) headers.vary = "Accept";
  if (!indexable) headers["x-robots-tag"] = "noindex, nofollow";
  if (cacheTags?.length) headers["cache-tag"] = cacheTags.join(",");
  if (options?.markdownAlternateHref) {
    headers.link = articleMarkdownAlternateLink(options.markdownAlternateHref);
  }
  if (options?.etag) headers.etag = options.etag;
  return headers;
}

/**
 * Listing routes must resolve entitlement on every request. Unlike article
 * routes, Astro's page cache can return a listing before route code runs, so a
 * stale paid response could outlive managed sponsorship expiry or revocation.
 */
export function publicListingResponseHeaders(
  site: SiteRow,
  env: PublicRuntimeEnv,
): Record<string, string> {
  const headers = publicHtmlResponseHeaders(site, env);
  headers["cache-control"] = "no-store";
  return headers;
}

function publicArticleResponseHeaders(
  site: SiteRow,
  env: PublicRuntimeEnv,
  siteId: string,
  postSlug: string,
  options?: PublicArticleHeaderOptions,
): Record<string, string> {
  return publicHtmlResponseHeaders(site, env, articleCacheTags(siteId, postSlug), options);
}

async function publicPostMarkdownResponse(
  db: D1Database,
  site: SiteRow,
  slug: string,
  request: Request,
  basePath: string,
  env: PublicRuntimeEnv,
) {
  const post = await getPublishedPost(db, site.id, slug);
  if (!post) return notFound();
  const origin = publicOrigin(request.url);
  const canonicalUrl = new URL(post.canonical_url || `${basePath}/${slug}`, origin).href;
  const markdownHref = new URL(`${basePath}/${slug}.md`, origin).href;
  const markdown = buildPostMarkdown(post, canonicalUrl);
  const validators = {
    etag: await contentEtag(markdown),
  };
  const response = new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      ...publicArticleResponseHeaders(site, env, site.id, slug, {
        markdownAlternateHref: markdownHref,
        ...validators,
      }),
    },
  });
  return conditionalArticleResponse(request, response, validators);
}

function hasContentEtag(response: Response): boolean {
  return /^(?:W\/)?"vc2-sha256-[0-9a-f]{64}"$/.test(response.headers.get("etag") || "");
}

export async function tryPublicPostMarkdownResponse(
  db: D1Database,
  request: Request,
  site: SiteRow,
  basePath: string,
  rawSlug: string | undefined,
  env: PublicRuntimeEnv,
): Promise<Response | null> {
  const { slug, markdown } = stripMarkdownSuffix(rawSlug);
  if (!markdown && !markdownRequested(request)) return null;
  if (!slug) return notFound();

  const cached = await matchArticleResponseCache(request.url, "markdown");
  if (
    site.effective_entitlement.effective
    && cached
    && cachedArticleResponseBelongsToSite(cached, site.id)
    && hasContentEtag(cached)
  ) {
    return conditionalCachedArticleResponse(request, cached);
  }

  const response = await publicPostMarkdownResponse(db, site, slug, request, basePath, env);
  if (response.ok && site.effective_entitlement.effective) {
    await putArticleResponseCache(request.url, "markdown", response);
  }
  return response;
}

/**
 * Markdown negotiation + markdown response-cache lookup run before any HTML page-cache hit.
 * Returns null when the caller should continue with the HTML page path.
 */
export async function handlePublicPostByHostGet(
  db: D1Database,
  request: Request,
  slug: string | undefined,
  env: PublicRuntimeEnv,
) {
  const { slug: stripped } = stripMarkdownSuffix(slug);
  if (!stripped || RESERVED_ROOT_SLUGS.has(stripped)) return null;

  const { markdown } = stripMarkdownSuffix(slug);
  if (!markdown && !markdownRequested(request)) return null;

  const site = await resolveSite(request, db, env);
  if (!site) return notFound();
  return tryPublicPostMarkdownResponse(db, request, site, "", slug, env);
}

export const ARTICLE_HTML_CACHE_HIT_HEADER = "x-vc-article-html-cache-hit";

/** HTML Workers Cache lookup — only after markdown negotiation has declined the request. */
export async function matchCachedPublicPostHtml(
  request: Request,
  siteId: string,
): Promise<Response | undefined> {
  const cached = await matchArticleResponseCache(request.url, "html");
  if (
    !cached
    || !cachedArticleResponseBelongsToSite(cached, siteId)
    || !hasContentEtag(cached)
  ) return undefined;
  const response = conditionalCachedArticleResponse(request, cached);
  const headers = new Headers(response.headers);
  headers.set(ARTICLE_HTML_CACHE_HIT_HEADER, "1");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function cachePublicPostHtmlResponse(
  requestUrl: string,
  response: Response,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  await putArticleResponseCache(requestUrl, "html", response, waitUntil);
}

export type PublicPostLoaderData = {
  site: SiteRow;
  post: PostDetailRow;
  basePath: string;
  canonicalUrl: string;
  origin: string;
  indexable: boolean;
  cacheTags: string[];
};

export async function loadPublicPostForSite(
  db: D1Database,
  requestUrl: string,
  site: SiteRow,
  slug: string | undefined,
  env: PublicRuntimeEnv,
): Promise<PublicPostLoaderData | null> {
  const { slug: postSlug } = stripMarkdownSuffix(slug);
  if (!postSlug || RESERVED_ROOT_SLUGS.has(postSlug)) return null;
  const post = await getPublishedPost(db, site.id, postSlug);
  if (!post) return null;
  const origin = publicOrigin(requestUrl);
  return {
    site,
    post,
    basePath: "",
    canonicalUrl: post.canonical_url || `/${post.slug}`,
    origin,
    indexable: isPublicBlogIndexable(site, env),
    cacheTags: articleCacheTags(site.id, post.slug),
  };
}

export async function loadPublicPostByHost(
  db: D1Database,
  request: Request,
  slug: string | undefined,
  env: PublicRuntimeEnv,
): Promise<PublicPostLoaderData | null> {
  const site = await resolveSite(request, db, env);
  if (!site) return null;
  return loadPublicPostForSite(db, request.url, site, slug, env);
}

export type PublicListingContext =
  | { kind: "index" }
  | { kind: "tag"; tag: string }
  | { kind: "search"; query: string };

export type PublicIndexLoaderData = {
  site: SiteRow;
  posts: PostSummaryRow[];
  basePath: string;
  indexable: boolean;
  listing: PublicListingContext;
};

export async function loadPublicIndexByHost(
  db: D1Database,
  request: Request,
  env: PublicRuntimeEnv,
  query?: string,
): Promise<PublicIndexLoaderData | null> {
  const site = await resolveSite(request, db, env);
  if (!site) return null;
  if (query !== undefined) {
    const posts = await searchPublishedPostSummaries(db, site.id, query);
    return { site, posts, basePath: "", indexable: false, listing: { kind: "search", query } };
  }
  const posts = await listPublishedPostSummaries(db, site.id);
  return {
    site,
    posts,
    basePath: "",
    indexable: isPublicBlogIndexable(site, env),
    listing: { kind: "index" },
  };
}

export async function loadPublicTagByHost(
  db: D1Database,
  request: Request,
  tag: string,
  env: PublicRuntimeEnv,
): Promise<PublicIndexLoaderData | null> {
  const site = await resolveSite(request, db, env);
  if (!site) return null;
  const posts = await listPublishedPostSummariesByTag(db, site.id, tag);
  if (posts.length === 0) return null;
  return {
    site,
    posts,
    basePath: "",
    indexable: isPublicBlogIndexable(site, env),
    listing: { kind: "tag", tag },
  };
}