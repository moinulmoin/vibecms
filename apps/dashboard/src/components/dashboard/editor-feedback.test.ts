import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderRichContent } from '@vc/content'
import { PresentedPostArticle } from '@vc/content/presented-post'
import { describe, expect, it } from 'vitest'
import { isPreviewCurrent } from './MarkdownEditor'
import { resolveFormStatus } from './useFormStatusFromSearch'

describe('dashboard preview article contract', () => {
  const ARTICLE_MD = `# My Article

An introductory lede paragraph that serves as the excerpt.

## First section

Body text under the first section heading.

## Second section

Body text under the second section heading.

### Subsection detail

Nested detail text.
`

  const renderResult = renderRichContent(ARTICLE_MD, { pageTitle: 'My Article' })
  const presentation = { layout: 'essay' as const, toc: true }

  function previewHtml(overrides: Record<string, unknown> = {}): string {
    return renderToStaticMarkup(
      createElement(PresentedPostArticle, {
        renderResult,
        presetId: 'essay',
        presentation,
        title: 'My Article',
        excerpt: 'An introductory lede paragraph that serves as the excerpt.',
        byline: 'Author',
        dateText: '2026-01-01',
        readingMinutes: 3,
        tags: ['essay', 'writing'],
        basePath: '/blog',
        ...overrides,
      }),
    )
  }

  it('renders exactly one semantic H1 with the page title', () => {
    const html = previewHtml()
    const h1Matches = html.match(/<h1\b/g)
    expect(h1Matches).toHaveLength(1)
    expect(html).toContain('<h1')
    expect(html).toContain('My Article')
  })

  it('removes the matching leading H1 from the body so it does not appear as a duplicate heading', () => {
    const html = previewHtml()
    // The body prose is inside [data-rich-content]; an H1 there would duplicate the title H1.
    const bodyStart = html.indexOf('data-rich-content')
    const bodySlice = html.slice(bodyStart)
    const h1InBody = bodySlice.match(/<h1\b/)
    expect(h1InBody).toBeNull()
  })

  it('renders the excerpt deck between the title and the first body paragraph', () => {
    const html = previewHtml()
    const h1Pos = html.indexOf('<h1')
    const deckPos = html.indexOf('An introductory lede paragraph that serves as the excerpt.')
    const metaPos = html.indexOf('By Author')
    const tagsPos = html.indexOf('/blog/tag/essay')
    const bodyTextPos = html.indexOf('Body text under the first section heading.')
    expect(h1Pos).toBeLessThan(deckPos)
    expect(deckPos).toBeLessThan(metaPos)
    expect(metaPos).toBeLessThan(tagsPos)
    expect(tagsPos).toBeLessThan(bodyTextPos)
  })

  it('renders a TOC with both disclosure and navigation for a structured outline', () => {
    const html = previewHtml()
    // Mobile <details> disclosure
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    // Desktop <nav> rail
    expect(html).toContain('<nav')
    expect(html).toContain('aria-label="On this page"')
    // Outline headings are present as navigation links
    expect(html).toContain('First section')
    expect(html).toContain('Second section')
    expect(html).toContain('Subsection detail')
  })

  it('does not render TOC when the presentation disables it', () => {
    const html = previewHtml({ presentation: { layout: 'standard' as const, toc: false } })
    expect(html).not.toContain('<details')
    expect(html).not.toContain('<nav')
  })
})

describe('dashboard form-status feedback', () => {
  it.each([
    ['post_created', 'Post created'],
    ['post_saved', 'Changes saved'],
    ['post_published', 'Post published'],
    ['post_archived', 'Post archived'],
  ])('resolves the allowlisted %s success status', (code, title) => {
    expect(resolveFormStatus({ ok: code })).toMatchObject({ variant: 'success', title })
  })

  it('renders an allowlisted conflict before any success status', () => {
    expect(resolveFormStatus({ ok: 'post_saved', error: 'version_conflict' })).toMatchObject({
      variant: 'error',
      title: 'Post changed',
      message: 'Review the latest version, then publish again.',
    })
  })

  it('keeps unknown error feedback generic and does not show unknown success codes', () => {
    expect(resolveFormStatus({ error: 'untrusted-message' })).toMatchObject({
      variant: 'error',
      title: 'Something went wrong',
    })
    expect(resolveFormStatus({ ok: 'untrusted-message' })).toBeNull()
  })

  it('resolves archive/restore error and restore success feedback used by PostEditorPage', () => {
    expect(resolveFormStatus({ error: 'unknown' })).toMatchObject({
      variant: 'error',
      title: 'Something went wrong',
    })
    expect(resolveFormStatus({ error: 'version_conflict' })).toMatchObject({
      variant: 'error',
      title: 'Post changed',
    })
    expect(resolveFormStatus({ ok: 'post_restored' })).toMatchObject({
      variant: 'success',
      title: 'Version restored',
    })
  })
})

describe('Markdown preview freshness', () => {
  it('is current only when both Markdown and post metadata match the rendered snapshot', () => {
    expect(isPreviewCurrent(2, 2, 4, 4)).toBe(true)
    expect(isPreviewCurrent(3, 3, 4, 4)).toBe(true)
    expect(isPreviewCurrent(3, 2, 4, 4)).toBe(false)
    expect(isPreviewCurrent(2, 2, 5, 4)).toBe(false)
  })
})
