import { renderRichContentToHtml } from "@vc/content";
import { BRAND } from "@vc/config";
import type { PublicRuntimeEnv } from "../env";
import {
  isMarketingHost,
  isPublicBlogIndexable,
  listPublishedPostSummaries,
  listPublishedPostsForFeed,
  PUBLIC_BLOG_LIMITS,
  resolveSite,
  type PostSummaryRow,
  type SiteRow,
} from "./public-blog-data";
import { buildRssXml, buildSitemapXml, xmlEscape } from "./public-feeds-xml";
import { sanitizeLlmsField } from "./llms-text";
import { publicCacheControlForEntitlement, siteCacheTag } from "./public-blog-cache";
import { publicOrigin } from "./public-url";

const cacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

function robotsTagHeaders(site: SiteRow, env: PublicRuntimeEnv): Record<string, string> {
  return isPublicBlogIndexable(site, env) ? {} : { "x-robots-tag": "noindex, nofollow" };
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

function productSitemap(origin: string): Response {
  const urls = [`${origin}/`, `${origin}/docs`];
  const body = urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": cacheControl },
  });
}

function productLlmsTxt(origin: string, env: PublicRuntimeEnv): Response {
  const loginUrl = `${env.appUrl.replace(/\/$/, "")}/login`;
  const mcpUrl = `${env.appUrl.replace(/\/$/, "")}/mcp`;
  const lines = [
    `# ${BRAND.name}`,
    "",
    `> ${BRAND.description}`,
    "",
    "## Links",
    "",
    `- [Product home](${origin}/)`,
    `- [Sign in](${loginUrl})`,
    "",
    "## For agents",
    "",
    `- MCP endpoint: ${mcpUrl} (JSON-RPC over POST; scoped bearer token, created by the site owner in the dashboard).`,
    "- Blogs hosted here serve every post as clean Markdown at `/<slug>.md` and publish their own `/llms.txt`.",
  ];
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": cacheControl },
  });
}

export async function handleFeed(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return notFound();
  const requestUrl = new URL(request.url);
  const origin = publicOrigin(requestUrl);
  const posts = await listPublishedPostsForFeed(db, site.id, PUBLIC_BLOG_LIMITS.feedBodies);
  const xml = buildRssXml(site, origin, posts, new URL(`${requestUrl.pathname}${requestUrl.search}`, origin).href, (post) =>
    renderRichContentToHtml(post.content_markdown),
  );
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": publicCacheControlForEntitlement(site.effective_entitlement),
      "cache-tag": siteCacheTag(site.id),
      ...robotsTagHeaders(site, env),
    },
  });
}

export async function handleSitemap(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return isMarketingHost(request, env) ? productSitemap(publicOrigin(request.url)) : notFound();
  if (!isPublicBlogIndexable(site, env)) return notFound();
  const origin = publicOrigin(request.url);
  const posts = await listPublishedPostSummaries(db, site.id, PUBLIC_BLOG_LIMITS.sitemapSummaries);
  const xml = buildSitemapXml(origin, posts);
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": publicCacheControlForEntitlement(site.effective_entitlement),
      "cache-tag": siteCacheTag(site.id),
    },
  });
}

export async function handleRobots(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  const origin = publicOrigin(request.url);
  const indexable = (site ? isPublicBlogIndexable(site, env) : false) || isMarketingHost(request, env);
  const body = indexable
    ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
    : "User-agent: *\nAllow: /\n";
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": site
        ? publicCacheControlForEntitlement(site.effective_entitlement)
        : cacheControl,
      ...(site ? { "cache-tag": siteCacheTag(site.id) } : {}),
    },
  });
}

function renderLlmsTxt(site: SiteRow, origin: string, basePath: string, posts: PostSummaryRow[], env: PublicRuntimeEnv): Response {
  const summary = site.description || site.default_seo_description || "";
  const lines = [`# ${sanitizeLlmsField(site.name)}`, ""];
  if (summary) lines.push(`> ${sanitizeLlmsField(summary)}`, "");
  lines.push("## Posts", "");
  if (posts.length === 0) {
    lines.push("No published posts yet.");
  } else {
    for (const post of posts) {
      const description = post.excerpt || post.seo_description || "";
      lines.push(`- [${sanitizeLlmsField(post.title)}](${origin}${basePath}/${post.slug}.md)${description ? `: ${sanitizeLlmsField(description)}` : ""}`);
    }
  }
  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": publicCacheControlForEntitlement(site.effective_entitlement),
      "cache-tag": siteCacheTag(site.id),
      ...robotsTagHeaders(site, env),
    },
  });
}

export async function handleLlmsTxt(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return isMarketingHost(request, env) ? productLlmsTxt(publicOrigin(request.url), env) : notFound();
  return renderLlmsTxt(
    site,
    publicOrigin(request.url),
    "",
    await listPublishedPostSummaries(db, site.id, PUBLIC_BLOG_LIMITS.llmsSummaries),
    env,
  );
}
