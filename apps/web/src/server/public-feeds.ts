import { isMarketingHost } from "./public-blog";
import { BRAND } from "@vc/config";
import { isPublicBlogIndexable, listPublishedPosts, resolveSite, type PostRow, type SiteRow } from "./public-blog-data";
import { buildRssXml, buildSitemapXml, xmlEscape } from "./public-feeds-xml";
import { renderRichContentToHtml } from "../lib/markdown";

const cacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

/** Non-indexable (unpaid) blogs render but must not be advertised to crawlers/agents. */
function robotsTagHeaders(site: SiteRow): Record<string, string> {
  return isPublicBlogIndexable(site) ? {} : { "x-robots-tag": "noindex, nofollow" };
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

function productSitemap(origin: string): Response {
  const urls = [`${origin}/`, `${origin}/login`];
  const body = urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": cacheControl },
  });
}

function productLlmsTxt(origin: string): Response {
  const lines = [
    `# ${BRAND.name}`,
    "",
    `> ${BRAND.tagline} ${BRAND.description}`,
    "",
    "## Pages",
    "",
    `- [Home](${origin}/)`,
    `- [Sign in](${origin}/login)`,
    "",
    "## For AI agents",
    "",
    `- MCP endpoint: ${origin}/mcp - JSON-RPC 2.0 over HTTP with a Bearer token. Send initialize for usage instructions, then tools/list.`,
    "- Each hosted blog serves its own /llms.txt and per-post markdown (Accept: text/markdown or a .md suffix).",
    `- Source: ${BRAND.repoUrl}`,
  ];
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": cacheControl },
  });
}

/** RSS 2.0 feed of published posts for the resolved blog host. */
export async function handleFeed(request: Request): Promise<Response> {
  const site = await resolveSite(request);
  if (!site) return notFound();
  const origin = new URL(request.url).origin;
  const posts = await listPublishedPosts(site.id);

  const xml = buildRssXml(site, origin, posts, new URL(request.url).href, (post) => renderRichContentToHtml(post.content_markdown));

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": cacheControl, ...robotsTagHeaders(site) },
  });
}

/** XML sitemap for resolvable blog hosts (self-host or active subscription). */
export async function handleSitemap(request: Request): Promise<Response> {
  const site = await resolveSite(request);
  if (!site) return isMarketingHost(request) ? productSitemap(new URL(request.url).origin) : notFound();
  if (!isPublicBlogIndexable(site)) return notFound();
  const origin = new URL(request.url).origin;
  const posts = await listPublishedPosts(site.id);

  const xml = buildSitemapXml(origin, posts);

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": cacheControl },
  });
}

/** robots.txt. Blog hosts: allow + sitemap. Other hosts: allow. */
export async function handleRobots(request: Request): Promise<Response> {
  const site = await resolveSite(request);
  const origin = new URL(request.url).origin;

  const indexable = (site ? isPublicBlogIndexable(site) : false) || isMarketingHost(request);
  const body = indexable
    ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
    : "User-agent: *\nAllow: /\n";

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": cacheControl },
  });
}

/** Shared llms.txt renderer: H1 name, blockquote summary, and post links to clean markdown. */
function renderLlmsTxt(site: SiteRow, origin: string, basePath: string, posts: PostRow[]): Response {
  const summary = site.description || site.default_seo_description || "";
  const lines = [`# ${site.name}`, ""];
  if (summary) lines.push(`> ${summary}`, "");
  lines.push("## Posts", "");
  if (posts.length === 0) {
    lines.push("No published posts yet.");
  } else {
    for (const post of posts) {
      const description = post.excerpt || post.seo_description || "";
      lines.push(`- [${post.title}](${origin}${basePath}/${post.slug}.md)${description ? `: ${description}` : ""}`);
    }
  }
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": cacheControl, ...robotsTagHeaders(site) },
  });
}

/** llms.txt for a custom-domain blog host so AI agents can discover posts and fetch clean markdown. */
export async function handleLlmsTxt(request: Request): Promise<Response> {
  const site = await resolveSite(request);
  if (!site) return isMarketingHost(request) ? productLlmsTxt(new URL(request.url).origin) : notFound();
  return renderLlmsTxt(site, new URL(request.url).origin, "", await listPublishedPosts(site.id));
}