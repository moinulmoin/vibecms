import { describe, expect, it } from 'vitest'
import { buildPostHeadContent, resolveSocialImage, type SeoPostInput, type SeoSiteInput } from './seo-meta'

const post: SeoPostInput = {
  title: 'A useful article',
  excerpt: 'A concise summary.',
  published_at: 1_700_000_000,
  updated_at: 1_700_000_100,
  cover_asset_id: 'cover-1',
  cover_asset_mime_type: 'image/webp',
  cover_asset_width: 1200,
  cover_asset_height: 630,
  cover_asset_alt_text: 'A diagram of the publishing workflow',
  seo_title: null,
  seo_description: null,
  canonical_url: null,
}

const site: SeoSiteInput = {
  name: 'Example Blog',
  default_social_asset_id: 'site-social',
  default_social_asset_mime_type: 'image/png',
  default_social_asset_width: 1200,
  default_social_asset_height: 630,
  default_social_asset_alt_text: 'Example Blog social preview',
}

describe('social image metadata', () => {
  it('uses post image, then site default, then deterministic brand fallback', () => {
    expect(resolveSocialImage('https://blog.example.com', post, site)).toMatchObject({
      source: 'post',
      url: 'https://blog.example.com/media-assets/cover-1',
    })
    expect(resolveSocialImage('https://blog.example.com', { ...post, cover_asset_id: null }, site)).toMatchObject({
      source: 'site',
      url: 'https://blog.example.com/media-assets/site-social',
    })
    expect(resolveSocialImage('https://blog.example.com', null, { name: 'Example Blog' })).toEqual({
      source: 'brand',
      url: 'https://blog.example.com/brand/og.png',
      alt: 'VibeCMS',
      mimeType: 'image/png',
      width: 1200,
      height: 630,
    })
  })

  it('emits complete Open Graph and Twitter image fields and reuses the image in JSON-LD', () => {
    const head = buildPostHeadContent({
      post,
      site,
      canonicalUrl: '/a-useful-article',
      origin: 'https://blog.example.com',
      indexable: true,
    })
    const meta = new Map(head.meta.map((entry) => [String(entry.property ?? entry.name ?? 'title'), entry.content ?? entry.title]))

    expect(meta.get('og:image')).toBe('https://blog.example.com/media-assets/cover-1')
    expect(meta.get('og:image:type')).toBe('image/webp')
    expect(meta.get('og:image:width')).toBe('1200')
    expect(meta.get('og:image:height')).toBe('630')
    expect(meta.get('og:image:alt')).toBe('A diagram of the publishing workflow')
    expect(meta.get('twitter:image:alt')).toBe('A diagram of the publishing workflow')
    expect(meta.get('twitter:title')).toBe('A useful article - Example Blog')
    expect(meta.get('twitter:description')).toBe('A concise summary.')

    const jsonLd = JSON.parse(head.scripts[0]!.children) as { image: string }
    expect(jsonLd.image).toBe(meta.get('og:image'))
  })
})
