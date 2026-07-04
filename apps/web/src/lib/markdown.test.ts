import { describe, it, expect, beforeAll } from 'vitest';
import {
  renderRichContent,
  renderRichContentToHtml,
  validateRichContent,
} from './markdown';

// ─── Fixture ────────────────────────────────────────────────────────────────
// Covers every contract element:
//   callout · [[toc]] · headings · captioned image · fenced code · external link

const FIXTURE = `
> [!NOTE]
> Important info.

[[toc]]

## Alpha

## Beta

![a photo](img.png)
*A caption.*

\`\`\`ts
const x = 1;
\`\`\`

[x](https://example.com)
`.trim();

// ─── Group A: PARITY (golden markup contract) ────────────────────────────────

describe('PARITY – golden markup contract', () => {
  let html: string;
  // Compute once; vitest runs describe body synchronously before any it()
  beforeAll(() => {
    html = renderRichContentToHtml(FIXTURE);
  });

  it('callout carries vc-callout class', () => {
    expect(html).toContain('vc-callout');
  });

  it('callout carries data-callout="note"', () => {
    expect(html).toContain('data-callout="note"');
  });

  it('TOC nav element is present (data-toc)', () => {
    expect(html).toContain('data-toc');
  });

  it('TOC nav links to #h-alpha', () => {
    expect(html).toContain('href="#h-alpha"');
  });

  it('TOC nav links to #h-beta', () => {
    expect(html).toContain('href="#h-beta"');
  });

  it('captioned image wrapped in data-captioned figure', () => {
    expect(html).toContain('data-captioned');
  });

  it('caption text rendered in <figcaption>', () => {
    expect(html).toContain('<figcaption>');
  });

  it('fenced ts block carries data-lang="ts"', () => {
    expect(html).toContain('data-lang="ts"');
  });

  it('## Alpha heading has id="h-alpha"', () => {
    expect(html).toContain('id="h-alpha"');
  });

  it('external link carries nofollow in rel', () => {
    expect(html).toContain('nofollow');
  });

  it('renderRichContent outline matches the two headings', () => {
    const { outline } = renderRichContent(FIXTURE);
    expect(outline).toEqual([
      { depth: 2, text: 'Alpha', id: 'h-alpha' },
      { depth: 2, text: 'Beta', id: 'h-beta' },
    ]);
  });
});

// ─── Group B: XSS regression ────────────────────────────────────────────────

describe('XSS regression – sanitizer neutralizes attack vectors', () => {
  // Markdown containing four classic injection attempts.
  // allowDangerousHtml:false means raw HTML is escaped as text, never parsed;
  // rehype-sanitize's protocol allowlist strips javascript: from link hrefs.
  const MALICIOUS = `
<script>alert(1)</script>

[x](javascript:alert(1))

<img src=x onerror=alert(1)>

<iframe src=evil></iframe>
`.trim();

  let html: string;
  beforeAll(() => {
    html = renderRichContentToHtml(MALICIOUS);
  });

  it('no <script tag in output', () => {
    expect(html).not.toContain('<script');
  });

  it('no <iframe tag in output', () => {
    expect(html).not.toContain('<iframe');
  });

  it('no onerror attribute in output', () => {
    expect(html).not.toContain('onerror');
  });

  it('no javascript: href in output', () => {
    expect(html).not.toContain('href="javascript:');
  });
});

// ─── Group C: validateRichContent – content warnings ────────────────────────

describe('validateRichContent – content warnings', () => {
  it('warns on unknown callout type [!WARN]', () => {
    const warnings = validateRichContent('> [!WARN]\n> some text');
    expect(warnings.some((w) => w.toLowerCase().includes('unknown callout'))).toBe(true);
  });

  it('warns on image with empty alt text', () => {
    const warnings = validateRichContent('![](x.png)\n\nSome text.');
    expect(warnings.some((w) => w.toLowerCase().includes('missing alt'))).toBe(true);
  });

  it('warns when [[toc]] is present but no H2/H3 headings exist', () => {
    const warnings = validateRichContent('[[toc]]\n\nSome text without headings.');
    expect(warnings.some((w) => w.toLowerCase().includes('toc'))).toBe(true);
  });
});

// ─── Group D: edge cases (regression) ────────────────────────────────────────

describe('edge cases – renderer robustness', () => {
  it('image as the last/only child does not crash (children[i+1] undefined)', () => {
    expect(() => renderRichContentToHtml('![a cat](/cat.png)')).not.toThrow();
    expect(renderRichContentToHtml('![a cat](/cat.png)')).toContain('<img');
  });

  it('image with no following caption renders a plain img (no figure)', () => {
    const html = renderRichContentToHtml('Intro.\n\n![a cat](/cat.png)');
    expect(html).not.toContain('data-captioned');
    expect(html).toContain('<img');
  });

  it('blank line before emphasis yields a plain image, not a figure (grammar)', () => {
    const html = renderRichContentToHtml('![a cat](/cat.png)\n\n*A caption.*');
    expect(html).not.toContain('data-captioned');
    expect(html).toContain('<img');
    expect(html).toContain('<em>');
  });
});

// ─── Group E: h1 downgrade ───────────────────────────────────────────────────

describe('h1 downgrade', () => {
  it('downgrades author h1 to h2 (no <h1> in rendered body)', () => {
    const html = renderRichContentToHtml('# Top Heading\n\n## Second\n\nbody');
    // The article <h1> is rendered by PresentedPostArticle outside the markdown,
    // so the markdown body must contain zero <h1> tags.
    expect((html.match(/<h1[ >]/g) || []).length).toBe(0);
    // The original h1 became an h2 carrying the rehype-slug id (prefix 'h-').
    expect(html).toMatch(/<h2[^>]*id="h-top-heading"/);
  });

  it('downgraded h1 appears in the outline alongside real h2s', () => {
    const { outline } = renderRichContent('# A\n\n## B');
    expect(outline).toHaveLength(2);
    expect(outline.every((e) => e.depth === 2)).toBe(true);
    expect(outline.map((e) => e.text)).toEqual(['A', 'B']);
  });
});
