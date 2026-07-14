import { describe, it, expect, beforeAll } from "vitest";
import {
  renderRichContent,
  renderRichContentToHtml,
  validateRichContent,
  RENDERER_VERSION,
} from "./renderer.js";

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

describe("PARITY – golden markup contract", () => {
  let html: string;
  beforeAll(() => {
    html = renderRichContentToHtml(FIXTURE);
  });

  it("exports renderer version 2", () => {
    expect(RENDERER_VERSION).toBe("2");
  });

  it("callout carries vc-callout class", () => {
    expect(html).toContain("vc-callout");
  });

  it("callout carries data-callout=\"note\"", () => {
    expect(html).toContain('data-callout="note"');
  });

  it("TOC nav element is present (data-toc)", () => {
    expect(html).toContain("data-toc");
  });

  it("TOC nav links to #h-alpha", () => {
    expect(html).toContain('href="#h-alpha"');
  });

  it("captioned image wrapped in data-captioned figure", () => {
    expect(html).toContain("data-captioned");
  });

  it("fenced ts block carries data-lang=\"ts\" inside code frame", () => {
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain("vc-code-frame");
    expect(html).toContain("data-vc-code-frame");
  });

  it("code frame exposes deterministic copy control", () => {
    expect(html).toContain("vc-code-copy");
    expect(html).toContain('data-vc-copy="code"');
    expect(html).toContain("Copy");
  });

  it("## Alpha heading has id=\"h-alpha\" and permalink anchor", () => {
    expect(html).toContain('id="h-alpha"');
    expect(html).toContain("vc-heading-anchor");
    expect(html).toMatch(/aria-label="Permalink to Alpha"/);
  });

  it("external link carries nofollow in rel", () => {
    expect(html).toContain("nofollow");
  });

  it("renderRichContent outline matches the two headings", () => {
    const { outline } = renderRichContent(FIXTURE);
    expect(outline).toEqual([
      { depth: 2, text: "Alpha", id: "h-alpha" },
      { depth: 2, text: "Beta", id: "h-beta" },
    ]);
  });
});

describe("XSS regression – sanitizer neutralizes attack vectors", () => {
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

  it("no <script tag in output", () => {
    expect(html).not.toContain("<script");
  });

  it("no <iframe tag in output", () => {
    expect(html).not.toContain("<iframe");
  });

  it("no onerror attribute in output", () => {
    expect(html).not.toContain("onerror");
  });

  it("no javascript: href in output", () => {
    expect(html).not.toContain('href="javascript:');
  });

  it("strips onclick from malformed callout attempt", () => {
    const xssCallout = renderRichContentToHtml('> [!NOTE]\n> <img src=x onerror=alert(1)>');
    expect(xssCallout).not.toContain("onerror");
  });
});

describe("validateRichContent – content warnings", () => {
  it("warns on unknown callout type [!WARN]", () => {
    const warnings = validateRichContent("> [!WARN]\n> some text");
    expect(warnings.some((w) => w.toLowerCase().includes("unknown callout"))).toBe(true);
  });

  it("warns on image with empty alt text", () => {
    const warnings = validateRichContent("![](x.png)\n\nSome text.");
    expect(warnings.some((w) => w.toLowerCase().includes("missing alt"))).toBe(true);
  });

  it("warns when [[toc]] is present but no H2/H3 headings exist", () => {
    const warnings = validateRichContent("[[toc]]\n\nSome text without headings.");
    expect(warnings.some((w) => w.toLowerCase().includes("toc"))).toBe(true);
  });
});

describe("edge cases – renderer robustness", () => {
  it("image as the last/only child does not crash", () => {
    expect(() => renderRichContentToHtml("![a cat](/cat.png)")).not.toThrow();
    expect(renderRichContentToHtml("![a cat](/cat.png)")).toContain("<img");
  });

  it("blank line before emphasis yields a plain image, not a figure", () => {
    const html = renderRichContentToHtml("![a cat](/cat.png)\n\n*A caption.*");
    expect(html).not.toContain("data-captioned");
  });
});

describe("h1 downgrade", () => {
  it("downgrades author h1 to h2 (no <h1> in rendered body)", () => {
    const html = renderRichContentToHtml("# Top Heading\n\n## Second\n\nbody");
    expect((html.match(/<h1[ >]/g) || []).length).toBe(0);
    expect(html).toMatch(/<h2[^>]*id="h-top-heading"/);
  });

  it("removes exact-matching leading H1 when pageTitle is supplied", () => {
    const html = renderRichContentToHtml("# My Article\n\nParagraph", { pageTitle: "My Article" });
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h2");
    expect(html).not.toMatch(/<h[12][ >]/);
  });

  it("removes whitespace-normalized matching leading H1", () => {
    const html = renderRichContentToHtml("#  My   Article  \n\nParagraph", { pageTitle: "My Article" });
    expect(html).not.toMatch(/<h[12][ >]/);
  });

  it("leaves case-different H1 downgraded to H2 when pageTitle does not match", () => {
    const html = renderRichContentToHtml("# my article\n\nParagraph", { pageTitle: "My Article" });
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/<h2[^>]*id="h-my-article"/);
  });

  it("leaves non-matching H1 downgraded to H2 and in outline", () => {
    const { outline } = renderRichContent("# Different Title\n\nParagraph", { pageTitle: "My Article" });
    expect(outline).toEqual([{ depth: 2, text: "Different Title", id: "h-different-title" }]);
    const html = renderRichContentToHtml("# Different Title\n\nParagraph", { pageTitle: "My Article" });
    expect(html).toMatch(/<h2[^>]*id="h-different-title"/);
  });

  it("does not remove matching H1 that is not the leading element", () => {
    const md = "Some intro text.\n\n# My Article\n\nMore content";
    const html = renderRichContentToHtml(md, { pageTitle: "My Article" });
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/<h2[^>]*id="h-my-article"/);
  });
});

describe("GFM task-list and strikethrough", () => {
  it("task list survives sanitize", () => {
    const html = renderRichContentToHtml("- [x] Done\n- [ ] Todo");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('type="checkbox"');
  });

  it("strikethrough renders <del>", () => {
    const html = renderRichContentToHtml("~~gone~~");
    expect(html).toContain("<del>gone</del>");
  });
});

describe("outline and table-of-contents boundaries", () => {
  it("includes downgraded h1 headings in the outline", () => {
    const { outline } = renderRichContent("# A\n\n## B");
    expect(outline).toEqual([
      { depth: 2, text: "A", id: "h-a" },
      { depth: 2, text: "B", id: "h-b" },
    ]);
  });

  it("crosses the page-level ToC threshold at three h2/h3 headings", () => {
    expect(renderRichContent("## One\n\n## Two").outline).toHaveLength(2);
    expect(renderRichContent("## One\n\n### Sub\n\n### Sub2").outline).toHaveLength(3);
  });

  it("renders inline ToC links without leaking the marker", () => {
    const html = renderRichContentToHtml("[[toc]]\n\n## Only");
    expect(html).toContain("<nav");
    expect(html).toContain('href="#h-only"');
    expect(html).not.toContain("[[toc]]");
  });

  it("omits an inline ToC when no headings exist", () => {
    const html = renderRichContentToHtml("[[toc]]\n\nNo headings here.");
    expect(html).not.toContain("data-toc");
  });
});

describe("figures and GFM resilience", () => {
  it("renders a caption in figcaption", () => {
    const html = renderRichContentToHtml("![a cat](/cat.png)\n*A caption.*");
    expect(html).toContain("<figcaption>");
  });

  it("renders an uncaptioned image without a figure", () => {
    const html = renderRichContentToHtml("Intro.\n\n![a cat](/cat.png)");
    expect(html).toContain("<img");
    expect(html).not.toContain("data-captioned");
  });

  it("preserves tables and long inline link/code content", () => {
    const longToken = "very-long-inline-code-token-without-natural-breaks";
    const longUrl = "https://example.com/very-long-path-without-natural-breaks";
    const html = renderRichContentToHtml(
      `| Column A | Column B |
| --- | --- |
| Cell A | Cell B |

[${longUrl}](${longUrl})

\`${longToken}\``,
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Column A</th>");
    expect(html).toContain("<td>Cell A</td>");
    expect(html).toContain(`href="${longUrl}"`);
    expect(html).toContain(`<code>${longToken}</code>`);
  });

  it("preserves checked and unchecked task state", () => {
    expect(renderRichContentToHtml("- [x] Done")).toContain('checked=""');
    expect(renderRichContentToHtml("- [ ] Todo")).not.toContain('checked=""');
  });

  it("preserves nested task-list structure", () => {
    const html = renderRichContentToHtml("- [ ] parent\n  - [ ] child");
    expect(html.match(/class="contains-task-list"/g)).toHaveLength(2);
    expect(html).toContain('class="task-list-item"');
  });
});