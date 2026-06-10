import { isPublicBlogIndexable, listPublishedPosts, resolveSite } from "./public-blog";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cacheControl(indexable: boolean): string {
  return indexable
    ? "public, max-age=300, s-maxage=300, stale-while-revalidate=86400"
    : "no-store";
}

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

/** RSS 2.0 feed of published posts for the resolved blog host. */
export async function handleFeed(request: Request): Promise<Response> {
  const site = await resolveSite(request);
  if (!site) return notFound();
  const indexable = isPublicBlogIndexable(site);
  const origin = new URL(request.url).origin;
  const posts = indexable ? await listPublishedPosts(site.id) : [];

  const items = posts
    .map((post) => {
      const link = `${origin}/${post.slug}`;
      const pubDate = post.published_at ? new Date(post.published_at * 1000).toUTCString() : "";
      return [
        "    <item>",
        `      <title>${xmlEscape(post.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : "",
        `      <description>${xmlEscape(post.excerpt ?? "")}</description>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(site.name)}</title>
    <link>${xmlEscape(`${origin}/`)}</link>
    <description>${xmlEscape(site.description ?? site.name)}</description>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": cacheControl(indexable) },
  });
}

/** XML sitemap. Empty for non-indexable (trial) blogs so it matches the noindex header. */
export async function handleSitemap(request: Request): Promise<Response> {
  const site = await resolveSite(request);
  if (!site) return notFound();
  const indexable = isPublicBlogIndexable(site);
  const origin = new URL(request.url).origin;
  const posts = indexable ? await listPublishedPosts(site.id) : [];
  const urls = indexable ? [`${origin}/`, ...posts.map((post) => `${origin}/${post.slug}`)] : [];

  const body = urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": cacheControl(indexable) },
  });
}

/** robots.txt. Blog hosts: allow + sitemap when indexable, disallow on trial. Other hosts: allow. */
export async function handleRobots(request: Request): Promise<Response> {
  const site = await resolveSite(request);
  const origin = new URL(request.url).origin;

  let body: string;
  let indexable = true;
  if (!site) {
    body = "User-agent: *\nAllow: /\n";
  } else {
    indexable = isPublicBlogIndexable(site);
    body = indexable
      ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n";
  }

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": cacheControl(indexable) },
  });
}
