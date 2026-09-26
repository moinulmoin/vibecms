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

describe('SubscribeBlock settings', () => {
  it('uses custom copy when newsletter settings are provided', () => {
    const html = renderToStaticMarkup(
      <PublicPageChrome
        siteName="Example publication"
        homeHref="/"
        presetId="minimal"
        subscribeVariant="footer"
        subscribeSiteSlug="example"
        subscribeSettings={{
          enabled: true,
          heading: 'Stay in the loop',
          subtext: 'One note when something ships.',
          buttonLabel: 'Join list',
        }}
      >
        <p>Latest posts</p>
      </PublicPageChrome>,
    )
    expect(html).toContain('Stay in the loop')
    expect(html).toContain('One note when something ships.')
    expect(html).toContain('Join list')
  })

  it('omits the form when newsletter settings disable it', () => {
    const html = renderToStaticMarkup(
      <PublicPageChrome
        siteName="Example publication"
        homeHref="/"
        presetId="minimal"
        subscribeVariant="footer"
        subscribeSiteSlug="example"
        subscribeSettings={{ enabled: false }}
      >
        <p>Latest posts</p>
      </PublicPageChrome>,
    )
    expect(html).not.toContain('vc-subscribe-form')
  })
})

describe('PublicPageChrome site identity', () => {
  it('renders logo, safe navigation, and labelled SVG social links', () => {
    const html = renderToStaticMarkup(<PublicPageChrome
      siteName="A & B" logoUrl="/media-assets/logo"
      homeHref="/" allPostsHref="/" presetId="technical"
      navLinks={[{ label: '<About>', url: '/about' }, { label: 'External', url: 'https://example.com' }]}
      socialLinks={[{ kind: 'github', url: 'https://github.com/example' }, { kind: 'mastodon', url: 'https://mastodon.social/@example' }]}
    ><p>Posts</p></PublicPageChrome>);
    expect(html).toContain('src="/media-assets/logo"');
    expect(html).toContain('alt="A &amp; B"');
    expect(html).toContain('&lt;About&gt;');
    expect(html).not.toContain('<About>');
    expect(html).toMatch(/href="https:\/\/example.com" rel="noopener"/);
    expect(html).toContain('aria-label="GitHub"');
    expect(html).toContain('aria-label="Mastodon"');
    expect(html).toContain('rel="me noopener"');
    expect(html).toContain('<svg');
  });

  it('keeps Notebook navigation in the header for narrow pages, marked to hide beside the sidebar', () => {
    const html = renderToStaticMarkup(<PublicPageChrome
      siteName="Notes" homeHref="/" allPostsHref="/" presetId="technical"
      navLinks={[{ label: 'About', url: '/about' }]}
    ><p>Posts</p></PublicPageChrome>);
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    expect(header).toMatch(/<a href="\/about"[^>]*data-sidebar-dup=""/);
    expect(header).toContain('All posts');
  });
});

