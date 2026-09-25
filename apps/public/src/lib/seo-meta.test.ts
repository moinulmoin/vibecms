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
  it('uses the post cover, then a generated card in the blog theme; never vibecms branding', () => {
    expect(resolveSocialImage('https://blog.example.com', post, site)).toMatchObject({
      source: 'post',
      url: 'https://blog.example.com/media-assets/cover-1',
    })
    const generated = resolveSocialImage('https://blog.example.com', { ...post, slug: 'a-useful-article', cover_asset_id: null }, site)
    expect(generated).toMatchObject({
      source: 'generated',
      alt: 'A useful article',
      mimeType: 'image/png',
      width: 1200,
      height: 630,
    })
    expect(generated.url).toMatch(/^https:\/\/blog\.example\.com\/og\/a-useful-article\.png\?v=[0-9a-f]{16}$/)
  })

  it('index pages use the site default share image, then a generated home card', () => {
    expect(resolveSocialImage('https://blog.example.com', null, site)).toMatchObject({
      source: 'site',
      url: 'https://blog.example.com/media-assets/site-social',
    })
    const home = resolveSocialImage('https://blog.example.com', null, { name: 'Example Blog' })
    expect(home).toMatchObject({ source: 'generated', alt: 'Example Blog', width: 1200, height: 630 })
    expect(home.url).toMatch(/^https:\/\/blog\.example\.com\/og\.png\?v=[0-9a-f]{16}$/)
    expect(home.url).not.toContain('/brand/')
  })

  it('versions the card URL by everything the card shows', () => {
    const base = { ...post, slug: 'a-useful-article', cover_asset_id: null }
    const url = (p: SeoPostInput, s: SeoSiteInput = site) => resolveSocialImage('https://blog.example.com', p, s).url
    expect(url(base)).toBe(url({ ...base }))
    expect(url({ ...base, title: 'Renamed' })).not.toBe(url(base))
    expect(url({ ...base, updated_at: 1_700_000_200 })).not.toBe(url(base))
    expect(url({ ...base, published_by_agent: true })).not.toBe(url(base))
    expect(url(base, { ...site, theme_accent: 'rust' })).not.toBe(url(base))
    expect(url(base, { ...site, theme_mode: 'dark' })).not.toBe(url(base))
    expect(url(base, { ...site, byline_name: 'Ada' })).not.toBe(url(base))
  })

  it('falls back to the index image when the card fonts cannot draw the title', () => {
    expect(resolveSocialImage('https://blog.example.com', { ...post, slug: 'jp', title: '日本語のタイトル', cover_asset_id: null }, site)).toMatchObject({
      source: 'site',
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

  it('uses the public byline as the JSON-LD author, never an email', () => {
    const head = buildPostHeadContent({
      post,
      site: { ...site, byline_name: 'Ada Lovelace' },
      canonicalUrl: '/a-useful-article',
      origin: 'https://blog.example.com',
      indexable: true,
    })
    const jsonLd = JSON.parse(head.scripts[0]!.children) as { author: { '@type': string; name: string } }
    expect(jsonLd.author).toEqual({ '@type': 'Person', name: 'Ada Lovelace' })
  })
})
