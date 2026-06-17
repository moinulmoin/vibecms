const DEFAULT_OG_IMAGE = '/brand/og.png'

export const seo = ({
  title,
  description,
  keywords,
  image = DEFAULT_OG_IMAGE,
}: {
  title: string
  description?: string
  image?: string
  keywords?: string
}) => {
  const tags = [
    { title },
    { name: 'description', content: description },
    { name: 'keywords', content: keywords },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: image },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ]

  // The bundled default card is a fixed 1200x630; only assert dimensions for it.
  if (image === DEFAULT_OG_IMAGE) {
    tags.push(
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
    )
  }

  return tags
}