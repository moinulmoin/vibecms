/**
 * Pure SEO metadata builders for the public blog.
 *
 * Every function here is free of `cloudflare:workers` (and any other
 * server-only) imports so the module is node-unit-testable. The input types
 * are self-declared structural interfaces (`SeoPostInput` / `SeoSiteInput`)
 * whose snake_case field names deliberately mirror the app-layer `PostRow`
 * read model; callers can pass a subset of that row directly.
 *
 * Two builders compose the rest:
 *  - `buildBlogPostingJsonLd` emits the JSON-LD object (null fields omitted).
 *  - `buildPostHeadContent` emits the full TanStack `head()` payload.
 */

/** Snake_case subset of a published post row, matching the app-layer PostRow. */
export interface SeoPostInput {
  title: string;
  excerpt: string | null;
  published_at: number | null;
  updated_at: number | null;
  cover_asset_id: string | null;
  cover_asset_mime_type?: string | null;
  cover_asset_width?: number | null;
  cover_asset_height?: number | null;
  cover_asset_alt_text?: string | null;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
}

/** Minimal site identity consumed by the SEO builders. */
export interface SeoSiteInput {
  name: string;
  default_social_asset_id?: string | null;
  default_social_asset_mime_type?: string | null;
  default_social_asset_width?: number | null;
  default_social_asset_height?: number | null;
  default_social_asset_alt_text?: string | null;
}

/** Resolve `path` against `origin` and return the absolute href. */
export function absoluteUrlPath(origin: string, path: string): string {
  return new URL(path, origin).href;
}

export type ResolvedSocialImage = {
  url: string;
  alt: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  source: 'post' | 'site' | 'brand';
};

/**
 * One deterministic image decision shared by Open Graph, Twitter, and
 * structured data: post featured image → site default → VibeCMS fallback.
 */
export function resolveSocialImage(
  origin: string,
  post: SeoPostInput | null,
  site: SeoSiteInput,
): ResolvedSocialImage {
  if (post?.cover_asset_id) {
    return {
      url: absoluteUrlPath(origin, `/media-assets/${post.cover_asset_id}`),
      alt: post.cover_asset_alt_text || post.title,
      mimeType: post.cover_asset_mime_type || 'image/jpeg',
      width: post.cover_asset_width ?? null,
      height: post.cover_asset_height ?? null,
      source: 'post',
    };
  }
  if (site.default_social_asset_id) {
    return {
      url: absoluteUrlPath(origin, `/media-assets/${site.default_social_asset_id}`),
      alt: site.default_social_asset_alt_text || `${site.name} social preview`,
      mimeType: site.default_social_asset_mime_type || 'image/jpeg',
      width: site.default_social_asset_width ?? null,
      height: site.default_social_asset_height ?? null,
      source: 'site',
    };
  }
  return {
    url: absoluteUrlPath(origin, '/brand/og.png'),
    alt: 'VibeCMS',
    mimeType: 'image/png',
    width: 1200,
    height: 630,
    source: 'brand',
  };
}

/** W3C date (`YYYY-MM-DD`); empty string for null/undefined/NaN. */
export function formatW3CDate(epochSeconds: number | null): string {
  if (epochSeconds == null || Number.isNaN(epochSeconds)) return '';
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** ISO-8601 date-time; empty string for null. */
export function formatIsoDate(epochSeconds: number | null): string {
  if (epochSeconds == null) return '';
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Whether to surface an "Updated" badge. Both timestamps must be present and
 * the gap must reach `thresholdSeconds` (default 24h). The comparison is a
 * strict `<`, so a gap of exactly 86400s shows while 86399s does not.
 */
export function shouldShowUpdatedDate(
  publishedAt: number | null,
  updatedAt: number | null,
  thresholdSeconds: number = 86400,
): boolean {
  if (publishedAt == null || updatedAt == null) return false;
  return updatedAt - publishedAt >= thresholdSeconds;
}

/** Largest non-null epoch; null only when both inputs are null. */
export function maxPublishEpoch(
  publishedAt: number | null,
  updatedAt: number | null,
): number | null {
  if (publishedAt == null && updatedAt == null) return null;
  const values: number[] = [];
  if (publishedAt != null) values.push(publishedAt);
  if (updatedAt != null) values.push(updatedAt);
  return Math.max(...values);
}

/**
 * Serialize a JSON-LD object for safe embedding inside `<script>`. Replaces
 * every `<` with its JSON unicode escape so a closing `</script>` sequence in
 * any value cannot break out of the tag.
 */
export function serializeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

/** Build a schema.org `BlogPosting` object, omitting null / empty fields. */
export function buildBlogPostingJsonLd(input: {
  post: SeoPostInput;
  site: SeoSiteInput;
  origin: string;
  canonicalUrl: string;
  socialImage?: ResolvedSocialImage;
}): Record<string, unknown> {
  const { post, site, origin, canonicalUrl } = input;
  const socialImage = input.socialImage ?? resolveSocialImage(origin, post, site);

  const obj: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': absoluteUrlPath(origin, canonicalUrl),
    },
    publisher: { '@type': 'Organization', name: site.name },
    author: { '@type': 'Organization', name: site.name },
  };

  const description = post.seo_description || post.excerpt;
  if (description) obj.description = description;

  const datePublished = formatIsoDate(post.published_at);
  if (datePublished) obj.datePublished = datePublished;

  const dateModified = formatIsoDate(post.updated_at);
  if (dateModified) obj.dateModified = dateModified;

  obj.image = socialImage.url;

  return obj;
}

/** Inputs to the full TanStack `head()` payload builder. */
export interface PostHeadInput {
  post: SeoPostInput;
  site: SeoSiteInput;
  canonicalUrl: string;
  origin: string;
  indexable: boolean;
}

/**
 * Full head payload: title, description, OpenGraph / Twitter cards, optional
 * noindex robots, the canonical link, and the JSON-LD script.
 */
export function buildPostHeadContent(input: PostHeadInput): {
  meta: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  scripts: Array<{ type: string; children: string }>;
} {
  const { post, site, canonicalUrl, origin, indexable } = input;

  const seoTitle = post.seo_title || `${post.title} - ${site.name}`;
  const seoDescription = post.seo_description || post.excerpt || undefined;
  const effectiveCanonical = post.canonical_url || canonicalUrl;
  const absoluteCanonical = absoluteUrlPath(origin, effectiveCanonical);
  const socialImage = resolveSocialImage(origin, post, site);

  const meta: Array<Record<string, unknown>> = [{ title: seoTitle }];
  if (seoDescription) {
    meta.push({ name: 'description', content: seoDescription });
  }
  meta.push({ property: 'og:title', content: seoTitle });
  if (seoDescription) {
    meta.push({ property: 'og:description', content: seoDescription });
  }
  meta.push({ property: 'og:type', content: 'article' });
  meta.push({ property: 'og:url', content: absoluteCanonical });
  meta.push({ property: 'og:image', content: socialImage.url });
  meta.push({ property: 'og:image:type', content: socialImage.mimeType });
  if (socialImage.width) meta.push({ property: 'og:image:width', content: String(socialImage.width) });
  if (socialImage.height) meta.push({ property: 'og:image:height', content: String(socialImage.height) });
  meta.push({ property: 'og:image:alt', content: socialImage.alt });
  meta.push({ property: 'og:site_name', content: site.name });
  const publishedIso = formatIsoDate(post.published_at);
  if (publishedIso) meta.push({ property: 'article:published_time', content: publishedIso });
  const modifiedIso = formatIsoDate(post.updated_at);
  if (modifiedIso) meta.push({ property: 'article:modified_time', content: modifiedIso });
  meta.push({ name: 'twitter:card', content: 'summary_large_image' });
  meta.push({ name: 'twitter:title', content: seoTitle });
  if (seoDescription) meta.push({ name: 'twitter:description', content: seoDescription });
  meta.push({ name: 'twitter:image', content: socialImage.url });
  meta.push({ name: 'twitter:image:alt', content: socialImage.alt });
  if (!indexable) {
    meta.push({ name: 'robots', content: 'noindex,nofollow' });
  }

  const links: Array<Record<string, unknown>> = [
    { rel: 'canonical', href: absoluteCanonical },
  ];

  const scripts: Array<{ type: string; children: string }> = [
    {
      type: 'application/ld+json',
      children: serializeJsonLd(
        buildBlogPostingJsonLd({ post, site, origin, canonicalUrl: effectiveCanonical, socialImage }),
      ),
    },
  ];

  return { meta, links, scripts };
}
