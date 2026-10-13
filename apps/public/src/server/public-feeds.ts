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
  resolvePublishedLinkSlugs,
  type PostSummaryRow,
  type SiteRow,
} from "./public-blog-data";
import { buildRssXml, buildSitemapXml, xmlEscape } from "./public-feeds-xml";
import { sanitizeLlmsField } from "./llms-text";
import { publicCacheControlForEntitlement, siteCacheTag } from "./public-blog-cache";
import { publicOrigin } from "./public-url";
import { publicBaseUrl, type PublicLocation } from "./public-location";
import { resolveResponsiveMediaSource } from "../lib/media-assets";

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

export async function handleFeed(db: D1Database, request: Request, env: PublicRuntimeEnv, location?: PublicLocation): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return notFound();
  const requestUrl = new URL(request.url);
  const loc = location ?? { origin: publicOrigin(requestUrl), basePath: "", assetOrigin: publicOrigin(requestUrl), proxied: false };
  const homeBase = publicBaseUrl(loc);
  const posts = await listPublishedPostsForFeed(db, site.id, PUBLIC_BLOG_LIMITS.feedBodies);
  // The feed self link is this request's customer-facing URL. The caller's
  // request may already be synthesized to the location (pathname then carries
  // the base path), so prefix the origin only — never homeBase + pathname.
  const selfUrl = `${loc.origin}${requestUrl.pathname}${requestUrl.search}`;
  const postSlugs = await resolvePublishedLinkSlugs(db, site.id, posts.map((post) => post.content_markdown));
  const xml = buildRssXml(site, homeBase, posts, selfUrl, (post) =>
    renderRichContentToHtml(post.content_markdown, {
      target: "feed",
      pageTitle: post.title,
      baseUrl: `${homeBase}/${post.slug}`,
      assetOrigin: loc.assetOrigin,
      postBasePath: loc.basePath || undefined,
      postSlugs,
      resolveImage: resolveResponsiveMediaSource,
    }),
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

export async function handleSitemap(db: D1Database, request: Request, env: PublicRuntimeEnv, location?: PublicLocation): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return isMarketingHost(request, env) ? productSitemap(publicOrigin(request.url)) : notFound();
  if (!isPublicBlogIndexable(site, env)) return notFound();
  const origin = location ? publicBaseUrl(location) : publicOrigin(request.url);
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

export async function handleRobots(db: D1Database, request: Request, env: PublicRuntimeEnv, location?: PublicLocation): Promise<Response> {
  const site = await resolveSite(request, db, env);
  const sitemapBase = location ? publicBaseUrl(location) : publicOrigin(request.url);
  const indexable = (site ? isPublicBlogIndexable(site, env) : false) || isMarketingHost(request, env);
  // A tenant's writing belongs to its owner, so AI training is disabled by default.
  const contentSignal = site || !isMarketingHost(request, env)
    ? "search=yes, ai-input=yes, ai-train=no"
    : "search=yes, ai-input=yes, ai-train=yes";
  const body = indexable
    ? `User-agent: *\nAllow: /\nContent-Signal: ${contentSignal}\nSitemap: ${sitemapBase}/sitemap.xml\n`
    : `User-agent: *\nAllow: /\nContent-Signal: ${contentSignal}\n`;
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

export async function handleLlmsTxt(db: D1Database, request: Request, env: PublicRuntimeEnv, location?: PublicLocation): Promise<Response> {
  const site = await resolveSite(request, db, env);
  if (!site) return isMarketingHost(request, env) ? productLlmsTxt(publicOrigin(request.url), env) : notFound();
  const loc = location ?? { origin: publicOrigin(request.url), basePath: "", assetOrigin: publicOrigin(request.url), proxied: false };
  return renderLlmsTxt(
    site,
    loc.origin,
    loc.basePath,
    await listPublishedPostSummaries(db, site.id, PUBLIC_BLOG_LIMITS.llmsSummaries),
    env,
  );
}
