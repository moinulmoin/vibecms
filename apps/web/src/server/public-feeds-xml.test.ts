import { describe, expect, it } from 'vitest';
import { buildRssXml, buildSitemapXml, xmlEscape } from './public-feeds-xml';
import type { PostRow, SiteRow } from './public-blog-data';

const site: SiteRow = {
  id: 's1',
  workspace_id: 'w1',
  name: 'Acme & Co <Blog>',
  slug: 'acme',
  theme: 'default',
  description: 'The <acme> story & more',
  default_seo_title: null,
  default_seo_description: null,
  billing_status: 'active',
  current_period_end: null,
  published_count: null,
};

const basePost = {
  id: 'p1',
  title: 'Hello World',
  slug: 'hello-world',
  excerpt: 'A short summary & nothing more',
  content_markdown: '',
  cover_asset_id: null,
  seo_title: null,
  seo_description: null,
  canonical_url: null,
  tags_json: '[]',
  presentation_json: null,
} satisfies Omit<PostRow, 'published_at' | 'updated_at'>;

const ORIGIN = 'https://acme.example.com';
const FEED_URL = 'https://acme.example.com/feed.xml';

describe('xmlEscape', () => {
  it('escapes the five significant XML characters', () => {
    expect(xmlEscape(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });
});

describe('buildSitemapXml', () => {
  it('emits the urlset shell with the home entry first', () => {
    const xml = buildSitemapXml(ORIGIN, []);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '  <url><loc>https://acme.example.com/</loc></url>\n' +
        '</urlset>',
    );
  });

  it('derives per-post lastmod from max(published_at, updated_at)', () => {
    const published = 1_700_000_000; // 2023-11-14
    const updated = 1_710_000_000; // 2024-03-09
    const xml = buildSitemapXml(ORIGIN, [{ ...basePost, published_at: published, updated_at: updated }]);
    const expectedPostLastmod = new Date(updated * 1000).toISOString().slice(0, 10);
    // home lastmod mirrors the single post's newest epoch
    expect(xml).toContain(`  <url><loc>${ORIGIN}/</loc><lastmod>${expectedPostLastmod}</lastmod></url>`);
    expect(xml).toContain(
      `  <url><loc>${ORIGIN}/hello-world</loc><lastmod>${expectedPostLastmod}</lastmod></url>`,
    );
  });

  it('reflects updated_at when it is newer than published_at', () => {
    const published = 1_700_000_000;
    const updated = 1_720_000_000; // clearly newer
    const xml = buildSitemapXml(ORIGIN, [{ ...basePost, published_at: published, updated_at: updated }]);
    const publishedDay = new Date(published * 1000).toISOString().slice(0, 10);
    const updatedDay = new Date(updated * 1000).toISOString().slice(0, 10);
    expect(publishedDay).not.toBe(updatedDay);
    expect(xml).toContain(`<lastmod>${updatedDay}</lastmod>`);
    expect(xml).not.toContain(`<lastmod>${publishedDay}</lastmod>`);
  });

  it('omits lastmod when neither timestamp is resolvable', () => {
    const xml = buildSitemapXml(ORIGIN, [{ ...basePost, published_at: null, updated_at: NaN }]);
    expect(xml).toContain(`  <url><loc>${ORIGIN}/hello-world</loc></url>`);
    expect(xml).toContain(`  <url><loc>${ORIGIN}/</loc></url>`);
    expect(xml).not.toContain('<lastmod>');
  });

  it('escapes special characters in loc', () => {
    const xml = buildSitemapXml(ORIGIN, [{ ...basePost, published_at: null, updated_at: 0, slug: 'a&b<c>' }]);
    expect(xml).toContain(`${ORIGIN}/a&amp;b&lt;c&gt;`);
  });
});

describe('buildRssXml', () => {
  const renderHtml = (post: PostRow) => `<p>body for ${post.slug}</p>`;

  it('declares xmlns:atom and xmlns:content on the root rss element', () => {
    const xml = buildRssXml(site, ORIGIN, [], FEED_URL, renderHtml);
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">');
  });

  it('emits an atom:link rel=self pointing at the absolute feed url', () => {
    const xml = buildRssXml(site, ORIGIN, [], FEED_URL, renderHtml);
    expect(xml).toContain(
      `<atom:link href="${FEED_URL}" rel="self" type="application/rss+xml" />`,
    );
  });

  it('emits a channel lastBuildDate from the newest post epoch', () => {
    const older = 1_700_000_000;
    const newer = 1_710_000_000;
    const xml = buildRssXml(
      site,
      ORIGIN,
      [
        { ...basePost, published_at: older, updated_at: older },
        { ...basePost, published_at: newer, updated_at: newer },
      ],
      FEED_URL,
      renderHtml,
    );
    expect(xml).toContain(`<lastBuildDate>${new Date(newer * 1000).toUTCString()}</lastBuildDate>`);
  });

  it('omits lastBuildDate when no post has a resolvable epoch', () => {
    const xml = buildRssXml(
      site,
      ORIGIN,
      [{ ...basePost, published_at: null, updated_at: null as unknown as number }],
      FEED_URL,
      renderHtml,
    );
    expect(xml).not.toContain('<lastBuildDate>');
  });

  it('derives pubDate from max(published_at, updated_at)', () => {
    const published = 1_700_000_000;
    const updated = 1_710_000_000;
    const xml = buildRssXml(site, ORIGIN, [{ ...basePost, published_at: published, updated_at: updated }], FEED_URL, renderHtml);
    expect(xml).toContain(`<pubDate>${new Date(updated * 1000).toUTCString()}</pubDate>`);
  });

  it('omits pubDate when maxPublishEpoch resolves to null', () => {
    const xml = buildRssXml(
      site,
      ORIGIN,
      [{ ...basePost, published_at: null, updated_at: null as unknown as number }],
      FEED_URL,
      renderHtml,
    );
    expect(xml).not.toContain('<pubDate>');
  });

  it('keeps items in the given order (no re-sort)', () => {
    const older = { ...basePost, id: 'old', slug: 'old', published_at: 1_700_000_000, updated_at: 1_700_000_000 };
    const newer = { ...basePost, id: 'new', slug: 'new', published_at: 1_710_000_000, updated_at: 1_710_000_000 };
    const xml = buildRssXml(site, ORIGIN, [older, newer], FEED_URL, renderHtml);
    expect(xml.indexOf('/old</link>')).toBeLessThan(xml.indexOf('/new</link>'));
  });

  it('emits content:encoded with the rendered HTML, XML-escaped', () => {
    const xml = buildRssXml(
      site,
      ORIGIN,
      [{ ...basePost, slug: 'hello', published_at: 1_700_000_000, updated_at: 1_700_000_000 }],
      FEED_URL,
      () => '<p>a & b</p>',
    );
    expect(xml).toContain('<content:encoded>&lt;p&gt;a &amp; b&lt;/p&gt;</content:encoded>');
  });

  it('escapes site name, description, and item fields', () => {
    const xml = buildRssXml(site, ORIGIN, [], FEED_URL, renderHtml);
    expect(xml).toContain('<title>Acme &amp; Co &lt;Blog&gt;</title>');
    expect(xml).toContain('<description>The &lt;acme&gt; story &amp; more</description>');
  });
});
