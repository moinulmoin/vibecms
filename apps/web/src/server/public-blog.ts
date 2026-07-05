import {
  getPublishedPost,
  isPublicBlogIndexable,
  listPublishedPosts,
  listPublishedPostsByTag,
  searchPublishedPosts,
  resolveSite,
  type PostDetailRow,
  type PostRow,
  type SiteRow,
} from "./public-blog-data";
export { isMarketingHost } from "./public-blog-data";
import { articleCacheTag, publicCacheControl } from "./public-blog-cache";

export const RESERVED_ROOT_SLUGS = new Set([
  "dashboard",
  "api",
  "blog",
  "login",
  "mcp",
  "media-assets",
  "feed.xml",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
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

export function publicHtmlResponseHeaders(site: SiteRow, cacheTag?: string): Record<string, string> {
  const indexable = isPublicBlogIndexable(site);
  const headers: Record<string, string> = {
    "cache-control": publicCacheControl,
    "content-signal": indexable ? "ai-train=yes, search=yes, ai-input=yes" : "ai-train=no, search=no, ai-input=yes",
  };
  if (!indexable) headers["x-robots-tag"] = "noindex, nofollow";
  if (cacheTag) headers["cache-tag"] = cacheTag;
  return headers;
}

function publicResponseHeaders(site: SiteRow, siteId: string, postSlug: string | null): Record<string, string> {
  return publicHtmlResponseHeaders(site, postSlug ? articleCacheTag(siteId, postSlug) : undefined);
}

async function publicPostMarkdownResponse(site: SiteRow, slug: string, request: Request, basePath: string) {
  const post = await getPublishedPost(site.id, slug);
  if (!post) return notFound();
  const canonicalUrl = new URL(post.canonical_url || `${basePath}/${slug}`, request.url).href;
  return new Response(buildPostMarkdown(post, canonicalUrl), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      ...publicResponseHeaders(site, site.id, slug),
    },
  });
}

/** GET handler branch: markdown Response, or null to continue to HTML SSR. */
export async function tryPublicPostMarkdownResponse(
  request: Request,
  site: SiteRow,
  basePath: string,
  rawSlug: string | undefined,
): Promise<Response | null> {
  const { slug, markdown } = stripMarkdownSuffix(rawSlug);
  if (!markdown && !markdownRequested(request)) return null;
  if (!slug) return notFound();
  return publicPostMarkdownResponse(site, slug, request, basePath);
}

export async function handlePublicPostByHostGet(request: Request, slug: string | undefined) {
  const { slug: stripped } = stripMarkdownSuffix(slug);
  if (!stripped || RESERVED_ROOT_SLUGS.has(stripped)) return null;
  const site = await resolveSite(request);
  if (!site) return notFound();
  const md = await tryPublicPostMarkdownResponse(request, site, "", slug);
  if (md) return md;
  return null;
}

export type PublicPostLoaderData = {
  site: SiteRow;
  post: PostDetailRow;
  basePath: string;
  canonicalUrl: string;
  origin: string;
  indexable: boolean;
  cacheTag: string;
};

export async function loadPublicPostByHost(request: Request, slug: string | undefined): Promise<PublicPostLoaderData | null> {
  const { slug: postSlug } = stripMarkdownSuffix(slug);
  if (!postSlug || RESERVED_ROOT_SLUGS.has(postSlug)) return null;
  const site = await resolveSite(request);
  if (!site) return null;
  const post = await getPublishedPost(site.id, postSlug);
  if (!post) return null;
  const origin = new URL(request.url).origin;
  return {
    site,
    post,
    basePath: "",
    canonicalUrl: post.canonical_url || `/${post.slug}`,
    origin,
    indexable: isPublicBlogIndexable(site),
    cacheTag: articleCacheTag(site.id, post.slug),
  };
}

export type PublicListingContext =
  | { kind: "index" }
  | { kind: "tag"; tag: string }
  | { kind: "search"; query: string };

export type PublicIndexLoaderData = {
  site: SiteRow;
  posts: PostRow[];
  basePath: string;
  indexable: boolean;
  listing: PublicListingContext;
};

export async function loadPublicIndexByHost(request: Request, query?: string): Promise<PublicIndexLoaderData | null> {
  const site = await resolveSite(request);
  if (!site) return null;
  if (query !== undefined) {
    const posts = await searchPublishedPosts(site.id, query);
    return { site, posts, basePath: "", indexable: false, listing: { kind: "search", query } };
  }
  const posts = await listPublishedPosts(site.id);
  return { site, posts, basePath: "", indexable: isPublicBlogIndexable(site), listing: { kind: "index" } };
}

export async function loadPublicTagByHost(request: Request, tag: string): Promise<PublicIndexLoaderData | null> {
  const site = await resolveSite(request);
  if (!site) return null;
  const posts = await listPublishedPostsByTag(site.id, tag);
  if (posts.length === 0) return null;
  return { site, posts, basePath: "", indexable: isPublicBlogIndexable(site), listing: { kind: "tag", tag } };
}
