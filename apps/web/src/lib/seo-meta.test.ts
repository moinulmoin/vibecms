import { describe, it, expect } from 'vitest';
import {
  buildBlogPostingJsonLd,
  buildPostHeadContent,
  resolveOgImageUrl,
  formatW3CDate,
  formatIsoDate,
  shouldShowUpdatedDate,
  maxPublishEpoch,
  serializeJsonLd,
  type SeoPostInput,
  type SeoSiteInput,
} from './seo-meta';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const SITE: SeoSiteInput = { name: 'Acme' };
const ORIGIN = 'https://blog.example.com';

const FULL_POST: SeoPostInput = {
  title: 'Hello World',
  excerpt: 'A short excerpt.',
  published_at: 1699977600,
  updated_at: 1699977600 + 100000,
  cover_asset_id: 'cover123',
  seo_title: 'Hello SEO',
  seo_description: 'A hand-written SEO description.',
};

// ─── A. buildBlogPostingJsonLd — JSON-LD payload shape ───────────────────────

describe('buildBlogPostingJsonLd – JSON-LD payload shape', () => {
  it('declares schema.org context and BlogPosting type', () => {
    const ld = buildBlogPostingJsonLd({
      post: FULL_POST,
      site: SITE,
      origin: ORIGIN,
      canonicalUrl: '/hello',
    });
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('BlogPosting');
  });

  it('image is the absolute media-assets URL, not a relative path', () => {
    const ld = buildBlogPostingJsonLd({
      post: FULL_POST,
      site: SITE,
      origin: ORIGIN,
      canonicalUrl: '/hello',
    });
    expect(ld.image).toBe('https://blog.example.com/media-assets/cover123');
  });

  it('mainEntityOfPage @id is the absolute canonical', () => {
    const ld = buildBlogPostingJsonLd({
      post: FULL_POST,
      site: SITE,
      origin: ORIGIN,
      canonicalUrl: '/hello',
    });
    expect(ld.mainEntityOfPage).toMatchObject({
      '@type': 'WebPage',
      '@id': 'https://blog.example.com/hello',
    });
  });

  it('publisher and author fall back to site name as Organization', () => {
    const ld = buildBlogPostingJsonLd({
      post: FULL_POST,
      site: SITE,
      origin: ORIGIN,
      canonicalUrl: '/hello',
    });
    expect(ld.publisher).toEqual({ '@type': 'Organization', name: 'Acme' });
    expect(ld.author).toEqual({ '@type': 'Organization', name: 'Acme' });
  });

  it('prefers seo_description over excerpt for description', () => {
    const ld = buildBlogPostingJsonLd({
      post: FULL_POST,
      site: SITE,
      origin: ORIGIN,
      canonicalUrl: '/hello',
    });
    expect(ld.description).toBe('A hand-written SEO description.');
  });

  it('falls back to excerpt for description when seo_description is null', () => {
    const ld = buildBlogPostingJsonLd({
      post: { ...FULL_POST, seo_description: null },
      site: SITE,
      origin: ORIGIN,
      canonicalUrl: '/hello',
    });
    expect(ld.description).toBe('A short excerpt.');
  });

  it('omits nullable fields when every optional is null', () => {
    const bare: SeoPostInput = {
      title: 'Bare',
      excerpt: null,
      published_at: null,
      updated_at: null,
      cover_asset_id: null,
      seo_title: null,
      seo_description: null,
    };
    const ld = buildBlogPostingJsonLd({
      post: bare,
      site: SITE,
      origin: ORIGIN,
      canonicalUrl: '/bare',
    });
    expect(ld).not.toHaveProperty('description');
    expect(ld).not.toHaveProperty('image');
    expect(ld).not.toHaveProperty('datePublished');
    expect(ld).not.toHaveProperty('dateModified');
    // The always-present structural keys still survive.
    expect(Object.keys(ld).sort()).toEqual(
      ['@context', '@type', 'author', 'headline', 'mainEntityOfPage', 'publisher'].sort(),
    );
  });
});

// ─── B. resolveOgImageUrl — absolute og:image construction ───────────────────

describe('resolveOgImageUrl – absolute og:image URL', () => {
  it('uses the cover media-assets URL when a cover id is present', () => {
    expect(resolveOgImageUrl(ORIGIN, 'abc123')).toBe(
      'https://blog.example.com/media-assets/abc123',
    );
  });

  it('falls back to the brand card when coverAssetId is null', () => {
    expect(resolveOgImageUrl(ORIGIN, null)).toBe('https://blog.example.com/brand/og.png');
  });
});

// ─── C. shouldShowUpdatedDate — 24h threshold boundary ───────────────────────

describe('shouldShowUpdatedDate – 24h threshold boundary', () => {
  it('is false when the gap is one second under 24h', () => {
    expect(shouldShowUpdatedDate(1000, 1000 + 86399)).toBe(false);
  });

  it('is true at exactly 24h (strict >=)', () => {
    expect(shouldShowUpdatedDate(1000, 1000 + 86400)).toBe(true);
  });

  it('is true well past 24h', () => {
    expect(shouldShowUpdatedDate(1000, 1000 + 100000)).toBe(true);
  });

  it('is false when publishedAt is null regardless of updatedAt', () => {
    expect(shouldShowUpdatedDate(null, 999999999)).toBe(false);
  });

  it('is false when updatedAt is null', () => {
    expect(shouldShowUpdatedDate(1000, null)).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(shouldShowUpdatedDate(0, 60, 60)).toBe(true);
    expect(shouldShowUpdatedDate(0, 59, 60)).toBe(false);
  });
});

// ─── D. Date helpers ────────────────────────────────────────────────────────

describe('formatW3CDate – W3C date string', () => {
  it('returns empty string for null', () => {
    expect(formatW3CDate(null)).toBe('');
  });

  it('returns YYYY-MM-DD matching the epoch converted via UTC', () => {
    const epoch = 1699977600;
    const out = formatW3CDate(epoch);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toBe(new Date(epoch * 1000).toISOString().slice(0, 10));
  });
});

describe('formatIsoDate – ISO 8601 date-time', () => {
  it('returns empty string for null', () => {
    expect(formatIsoDate(null)).toBe('');
  });

  it('returns an ISO 8601 timestamp ending in Z', () => {
    const out = formatIsoDate(1699977600);
    expect(out.endsWith('Z')).toBe(true);
    // Round-trips to the same instant.
    expect(new Date(out).getTime()).toBe(1699977600 * 1000);
  });
});

describe('maxPublishEpoch – largest non-null epoch', () => {
  it('returns null when both inputs are null', () => {
    expect(maxPublishEpoch(null, null)).toBe(null);
  });

  it('returns the sole non-null value', () => {
    expect(maxPublishEpoch(null, 5)).toBe(5);
  });

  it('returns the larger of two non-null values', () => {
    expect(maxPublishEpoch(3, 7)).toBe(7);
  });
});

// ─── E. serializeJsonLd – script-safe escaping ──────────────────────────────

describe('serializeJsonLd – escapes </script> and round-trips', () => {
  it('escapes the < so the literal closing tag never appears', () => {
    const out = serializeJsonLd({ a: '</script>' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script>');
  });

  it('round-trips through JSON.parse back to the original object', () => {
    const original = { a: '</script>', b: '<img src=x>', n: 42, nested: { c: '<' } };
    expect(JSON.parse(serializeJsonLd(original))).toEqual(original);
  });
});

// ─── F. buildPostHeadContent — head payload ──────────────────────────────────

describe('buildPostHeadContent – head payload', () => {
  const head = buildPostHeadContent({
    post: FULL_POST,
    site: SITE,
    canonicalUrl: '/hello',
    origin: ORIGIN,
    indexable: true,
  });

  it('emits og:url as the absolute canonical', () => {
    expect(head.meta).toContainEqual({
      property: 'og:url',
      content: 'https://blog.example.com/hello',
    });
  });

  it('emits absolute og:image and canonical link', () => {
    expect(head.meta).toContainEqual({
      property: 'og:image',
      content: 'https://blog.example.com/media-assets/cover123',
    });
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: 'https://blog.example.com/hello',
    });
  });

  it('omits robots noindex when indexable and includes one JSON-LD script', () => {
    expect(head.meta.some((m) => m.name === 'robots')).toBe(false);
    expect(head.scripts).toHaveLength(1);
    expect(head.scripts[0]!.type).toBe('application/ld+json');
  });
});
