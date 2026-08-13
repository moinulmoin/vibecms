import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PublicPageChrome } from './public-chrome'

describe('PublicPageChrome heading semantics', () => {
  it('uses the site name as the homepage h1 without changing the brand link', () => {
    const html = renderToStaticMarkup(
      <PublicPageChrome
        siteName="Example publication"
        tagline="Notes on reliable software"
        homeHref="/"
        presetId="minimal"
        homeHeading
      >
        <p>Latest posts</p>
      </PublicPageChrome>,
    )

    expect(html).toContain('<h1')
    expect(html).toContain('<a href="/"')
    expect(html).toContain('Example publication')
  })

  it('keeps the masthead out of the heading outline on article pages', () => {
    const html = renderToStaticMarkup(
      <PublicPageChrome
        siteName="Example publication"
        homeHref="/"
        allPostsHref="/"
        presetId="minimal"
        article
      >
        <article><h1>Article title</h1></article>
      </PublicPageChrome>,
    )

    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toContain('<h1>Article title</h1>')
  })
})
