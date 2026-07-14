import { formatW3CDate, maxPublishEpoch } from '../lib/seo-meta';
import type { PostRow, SiteRow } from './public-blog-data';

/**
 * Pure, database-free XML builders for the public sitemap and RSS feed.
 *
 * Everything here must remain importable from a Node test without a Cloudflare
 * worker: no `cloudflare:workers`, no `env`, no Request/Response. Callers in
 * `public-feeds.ts` supply the resolved `origin`, ordered `posts`, and (for
 * RSS) the absolute `selfUrl`.
 */

/** Escape the five XML significant characters for safe text/attribute embedding. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a sitemap.xml document. The home entry (`${origin}/`) comes first and
 * carries a `<lastmod>` set to the newest `max(published_at, updated_at)` across
 * all posts. Each post entry follows with its own `<lastmod>` derived from
 * `max(published_at, updated_at)`. A `<lastmod>` is omitted whenever no date can
 * be resolved. Posts are emitted in the order given.
 */
export function buildSitemapXml(origin: string, posts: PostRow[]): string {
  const homeEpoch = posts.reduce<number | null>((max, post) => {
    const epoch = maxPublishEpoch(post.published_at, post.updated_at);
    return epoch == null ? max : Math.max(max ?? 0, epoch);
  }, null);
  const homeLastmod = formatW3CDate(homeEpoch);

  const lines: string[] = [
    `  <url><loc>${xmlEscape(`${origin}/`)}</loc>${homeLastmod ? `<lastmod>${homeLastmod}</lastmod>` : ''}</url>`,
  ];
  for (const post of posts) {
    const loc = `${origin}/${post.slug}`;
    const lastmod = formatW3CDate(maxPublishEpoch(post.published_at, post.updated_at));
    lines.push(`  <url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`);
  }
  const body = lines.join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

/**
 * Build an RSS 2.0 feed. The root `<rss>` declares `xmlns:atom` and the channel
 * carries an `<atom:link rel="self" type="application/rss+xml">` pointing at the
 * absolute `selfUrl`. Each item's `<pubDate>` is derived from
 * `max(published_at, updated_at)` (omitted when neither timestamp is present).
 * Items are emitted in the order given — the read model already orders by
 * `published_at` desc; this builder never re-sorts.
 */
export function buildRssXml(site: SiteRow, origin: string, posts: PostRow[], selfUrl: string, renderHtml: (post: PostRow) => string): string {
  const items = posts
    .map((post) => {
      const link = `${origin}/${post.slug}`;
      const epoch = maxPublishEpoch(post.published_at, post.updated_at);
      const pubDate = epoch != null ? new Date(epoch * 1000).toUTCString() : '';
      const description = post.excerpt ? xmlEscape(post.excerpt) : '';
      const html = xmlEscape(renderHtml(post));
      return `    <item>
      <title>${xmlEscape(post.title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="true">${xmlEscape(link)}</guid>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      ${description ? `<description>${description}</description>` : ''}
      <content:encoded>${html}</content:encoded>
    </item>`;
    })
    .join('\n');

  const lastBuildEpoch = posts.reduce<number | null>((max, post) => {
    const epoch = maxPublishEpoch(post.published_at, post.updated_at);
    return epoch == null ? max : Math.max(max ?? 0, epoch);
  }, null);
  const lastBuildDate = lastBuildEpoch != null ? new Date(lastBuildEpoch * 1000).toUTCString() : '';
  const lastBuildDateLine = lastBuildDate ? `    <lastBuildDate>${lastBuildDate}</lastBuildDate>\n` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xmlEscape(site.name)}</title>
    <link>${xmlEscape(origin)}/</link>
    ${site.description ? `<description>${xmlEscape(site.description)}</description>` : ''}
    <atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml" />
${lastBuildDateLine}${items}
  </channel>
</rss>`;
}
