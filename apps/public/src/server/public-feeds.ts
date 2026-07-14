import { renderRichContentToHtml } from "@vc/content";
import { BRAND } from "@vc/config";
import type { PublicRuntimeEnv } from "../env";
import {
  isMarketingHost,
  isPublicBlogIndexable,
  listPublishedPosts,
  resolveSite,
  type PostRow,
  type SiteRow,
} from "./public-blog-data";
import { buildRssXml, buildSitemapXml, xmlEscape } from "./public-feeds-xml";
import { siteCacheTag } from "./public-blog-cache";

const cacheControl = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

function robotsTagHeaders(site: SiteRow, env: PublicRuntimeEnv): Record<string, string> {
  return isPublicBlogIndexable(site, env) ? {} : { "x-robots-tag": "noindex, nofollow" };
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

function productLlmsTxt(origin: string, env: PublicRuntimeEnv): Response {
  const loginUrl = `${env.appUrl.replace(/\/$/, "")}/login`;
  const lines = [
    `# ${BRAND.name}`,
    "",
    `> ${BRAND.description}`,
    "",
    "## Links",
    "",
    `- [Product home](${origin}/)`,
    `- [Sign in](${loginUrl})`,
  ];
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": cacheControl },
  });
}

export async function handleFeed(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return notFound();
  const origin = new URL(request.url).origin;
  const posts = await listPublishedPosts(db, site.id);
  const xml = buildRssXml(site, origin, posts, new URL(request.url).href, (post) =>
    renderRichContentToHtml(post.content_markdown),
  );
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": cacheControl,
      "cache-tag": siteCacheTag(site.id),
      ...robotsTagHeaders(site, env),
    },
  });
}

export async function handleSitemap(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return isMarketingHost(request, env) ? productSitemap(new URL(request.url).origin) : notFound();
  if (!isPublicBlogIndexable(site, env)) return notFound();
  const origin = new URL(request.url).origin;
  const posts = await listPublishedPosts(db, site.id);
  const xml = buildSitemapXml(origin, posts);
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": cacheControl,
      "cache-tag": siteCacheTag(site.id),
    },
  });
}

export async function handleRobots(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  const origin = new URL(request.url).origin;
  const indexable = (site ? isPublicBlogIndexable(site, env) : false) || isMarketingHost(request, env);
  const body = indexable
    ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
    : "User-agent: *\nAllow: /\n";
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": cacheControl },
  });
}

function renderLlmsTxt(site: SiteRow, origin: string, basePath: string, posts: PostRow[], env: PublicRuntimeEnv): Response {
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
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": cacheControl,
      "cache-tag": siteCacheTag(site.id),
      ...robotsTagHeaders(site, env),
    },
  });
}

export async function handleLlmsTxt(db: D1Database, request: Request, env: PublicRuntimeEnv): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return isMarketingHost(request, env) ? productLlmsTxt(new URL(request.url).origin, env) : notFound();
  return renderLlmsTxt(site, new URL(request.url).origin, "", await listPublishedPosts(db, site.id), env);
}