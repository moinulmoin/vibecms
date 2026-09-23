const DEFAULT_OG_IMAGE = '/brand/og.png'

export const seo = ({
  title,
  description,
  keywords,
  image = DEFAULT_OG_IMAGE,
  url,
  siteName = 'vibecms',
}: {
  title: string
  description?: string
  image?: string
  keywords?: string
  url?: string
  siteName?: string
}) => {
  const tags = [
    { title },
    { name: 'description', content: description },
    { name: 'keywords', content: keywords },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: siteName },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ].filter((tag) => !('content' in tag) || tag.content)

  // The bundled card (relative or absolute) is a fixed 1200x630.
  if (image.endsWith(DEFAULT_OG_IMAGE)) {
    tags.push(
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
    )
  }

  return tags
}
