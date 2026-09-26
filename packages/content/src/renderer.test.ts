import { describe, it, expect, beforeAll } from "vitest";
import {
  renderRichContent,
  renderRichContentToHtml,
  validateRichContent,
  RENDERER_VERSION,
  applyCodeNotation,
  parseCodeMeta,
  HIGHLIGHT_CHAR_BUDGET,
  MATH_CHAR_BUDGET,
  MERMAID_MAX_CHARS,
  RENDER_WARNING,
  renderWarningCode,
  installCommand,
  parseHeadingMarkers,
} from "./renderer.js";
import { createMathRenderer } from "./math.js";
import { renderToStaticMarkup } from "react-dom/server";
import type React from "react";
import { createCodeHighlighter } from "./highlight.js";
import { BLOCKS_SAMPLE } from "../harness/blocks-sample.js";
import type { MathRenderer } from "./types.js";

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

  it("exports renderer version 4", () => {
    expect(RENDERER_VERSION).toBe("4");
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

  it("does not mistake a labeled code fence's closing line for an unlabeled fence", () => {
    const warnings = validateRichContent("```ts\nconst release = true;\n```");
    expect(warnings.some((w) => w.toLowerCase().includes("language identifier"))).toBe(false);
  });

  it("warns when an opening backtick or tilde code fence has no language", () => {
    expect(validateRichContent("```\nplain code\n```"))
      .toContain("One or more code fences are missing a language identifier (e.g. ` ```js `)");
    expect(validateRichContent("~~~\nplain code\n~~~"))
      .toContain("One or more code fences are missing a language identifier (e.g. ` ```js `)");
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

  it("applies bounded responsive attributes through the image resolver", () => {
    const html = renderRichContentToHtml("![a cat](/media-assets/cat)", {
      resolveImage: (src) => ({
        src: `${src}?w=860`,
        srcSet: `${src}?w=480 480w, ${src}?w=860 860w`,
        sizes: "(max-width: 860px) 100vw, 860px",
      }),
    });
    expect(html).toContain('src="/media-assets/cat?w=860"');
    expect(html).toContain('srcSet="/media-assets/cat?w=480 480w, /media-assets/cat?w=860 860w"');
    expect(html).toContain('sizes="(max-width: 860px) 100vw, 860px"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
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

describe("v3 markdown features", () => {
  it("renders :::callouts with custom and default titles", () => {
    const html = renderRichContentToHtml(":::tip[Pro tip]\nUse pnpm.\n:::\n\n:::danger\nStop.\n:::");
    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('<span class="vc-callout-label">Pro tip</span>');
    expect(html).toContain('data-callout="caution"');
    expect(html).toContain('<span class="vc-callout-label">Caution</span>');
  });

  it("renders :::details as a native disclosure", () => {
    const html = renderRichContentToHtml(":::details[More]\nHidden.\n:::");
    expect(html).toContain('<details class="vc-details"><summary>More</summary>');
  });

  it("keeps colon text that looks like directives as prose", () => {
    const html = renderRichContentToHtml("Meet at 12:30 about note:this and ::leaf");
    expect(html).toContain("12:30 about note:this");
    expect(html).toContain("::leaf");
  });

  it("warns and unwraps unknown container directives", () => {
    const { warnings } = renderRichContent(":::weird\nbody\n:::");
    expect(warnings.some((w) => w.includes(":::weird"))).toBe(true);
    expect(renderRichContentToHtml(":::weird\nbody\n:::")).toContain("<p>body</p>");
  });

  it("allows GitHub-safe raw HTML and warns about the rest", () => {
    const md = "<details><summary>S</summary>x <kbd>Cmd</kbd> H<sub>2</sub>O</details>\n\n<marquee>m</marquee>";
    const html = renderRichContentToHtml(md);
    expect(html).toContain("<kbd>Cmd</kbd>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).not.toContain("<marquee");
    expect(renderRichContent(md).warnings).toContain("HTML <marquee> is not allowed in posts and was removed");
  });

  it("strips ids, names, and styles from raw HTML", () => {
    const html = renderRichContentToHtml('<div id="x" name="y" style="color:red">d</div>');
    expect(html).toContain("<div>d</div>");
  });

  it("keeps footnotes out of the outline and preserves the backref class", () => {
    const md = "## One\n\nText.[^1]\n\n[^1]: Note.";
    expect(renderRichContent(md).outline).toEqual([{ depth: 2, text: "One", id: "h-one" }]);
    const html = renderRichContentToHtml(md);
    expect(html).toContain('class="data-footnote-backref"');
    expect(html).not.toContain('href="#footnote-label" class="vc-heading-anchor"');
  });

  it("nests h3 entries under their h2 in the inline toc", () => {
    const html = renderRichContentToHtml("[[toc]]\n\n## A\n\n### B");
    expect(html).toContain('<li><a href="#h-a">A</a><ul><li><a href="#h-b">B</a></li></ul></li>');
  });

  it("parses fence meta: title, line ranges, line numbers, notation", () => {
    const md = '```ts title="app.ts" {1} showLineNumbers\nconst a = 1;\nconst b = 2; // [!code ++]\n```';
    const html = renderRichContentToHtml(md);
    expect(html).toContain('<span class="vc-code-frame-title">app.ts</span>');
    expect(html).toContain('data-line-numbers="true"');
    expect(html).toContain('<span class="line" data-highlighted="true">const a = 1;</span>');
    expect(html).toContain('<span class="line" data-diff="add">const b = 2;</span>');
    expect(html).not.toContain("[!code");
  });

  it("treats a bare filename after the language as the title", () => {
    const html = renderRichContentToHtml("```ts src/index.ts\nx\n```");
    expect(html).toContain('<span class="vc-code-frame-title">src/index.ts</span>');
  });

  it("marks diff lines by prefix", () => {
    const html = renderRichContentToHtml("```diff\n- a\n+ b\n```");
    expect(html).toContain('data-diff="remove"');
    expect(html).toContain('data-diff="add"');
  });

  it("turns a bare YouTube link into a click-through card", () => {
    const html = renderRichContentToHtml("https://youtu.be/dQw4w9WgXcQ");
    expect(html).toContain('data-embed="youtube"');
    expect(html).toContain("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(html).not.toContain("<iframe");
  });

  it("removes a smart-quoted leading title h1", () => {
    const html = renderRichContentToHtml("# Don't panic\n\nBody", { pageTitle: "Don't panic" });
    expect(html).not.toMatch(/<h[12][ >]/);
  });

  it("feed target drops chrome and absolutizes URLs", () => {
    const html = renderRichContentToHtml("## A\n\n![x](/media-assets/a)\n\n```ts\nx\n```", {
      target: "feed",
      baseUrl: "https://b.example.com/post",
    });
    expect(html).not.toContain("vc-heading-anchor");
    expect(html).not.toContain("vc-code-copy");
    expect(html).toContain('src="https://b.example.com/media-assets/a"');
    expect(html).toContain('<pre><code class="language-ts">x</code></pre>');
  });
});

describe("adversarial input hardening", () => {
  it("keeps generated footnote ids but drops ids minted by raw HTML", () => {
    const html = renderRichContentToHtml(
      'a[^1]\n\n[^1]: note\n\n<p id="user-content-fn-1">spoof</p>\n\n<h2 id="footnote-label">x</h2>',
    );
    expect(html).toContain('<li id="user-content-fn-1">');
    expect(html).toContain('id="user-content-fnref-1"');
    expect(html).toContain('<h2 class="sr-only" id="footnote-label">');
    expect(html.match(/id="user-content-fn-1"/g)).toHaveLength(1);
    expect(html.match(/id="footnote-label"/g)).toHaveLength(1);
    expect(html).not.toContain("data-vc-generated-id");
  });

  it("does not smarten autolinked URLs", () => {
    const html = renderRichContentToHtml("https://example.com/a--b\n\nwww.example.com/x--y\n\nsee -- this");
    expect(html).toContain(">https://example.com/a--b</a>");
    expect(html).toContain(">www.example.com/x--y</a>");
    expect(html).toContain("see — this");
  });

  it("turns a bare YouTube link whose id contains -- into a card", () => {
    const html = renderRichContentToHtml("https://youtu.be/ab--cdefghi");
    expect(html).toContain('data-embed="youtube"');
  });

  it("removes a title H1 whose dashes/quotes smartypants rewrote", () => {
    for (const [title, body] of [
      ["A -- B", "# A -- B"],
      ["A --- B", "# A --- B"],
      ["A — B", "# A -- B"],
      ["``x''", "# ``x''"],
    ]) {
      const html = renderRichContentToHtml(`${body}\n\ntext`, { pageTitle: title });
      expect(html, title).not.toContain("<h2");
    }
  });

  it("parses code notation in linear time on adversarial whitespace", () => {
    const start = performance.now();
    applyCodeNotation(" ".repeat(200_000) + "x");
    applyCodeNotation("// [!code ++]" + " \t".repeat(100_000) + "x");
    expect(performance.now() - start).toBeLessThan(500);
    expect(applyCodeNotation("a -- // [!code ++]  ").code).toBe("a --");
    expect(applyCodeNotation("x <!-- [!code focus] -->").code).toBe("x");
    expect(applyCodeNotation("y {/* [!code hl] */}").marks.get(1)).toBe("highlight");
    expect(applyCodeNotation("[!code ++]").marks.size).toBe(0);
  });

  it("bounds highlight-range work in fence meta", () => {
    const start = performance.now();
    const meta = parseCodeMeta("{" + Array.from({ length: 50_000 }, (_, i) => `${i}-99999`).join(",") + "}");
    expect(performance.now() - start).toBeLessThan(500);
    expect(meta.highlight.size).toBeLessThanOrEqual(5000);
    expect([...parseCodeMeta("{1,3-4}").highlight]).toEqual([1, 3, 4]);
  });

  it("smartens typography per block in linear time", () => {
    const html = renderRichContentToHtml('He said "hi *there*" -- it\'s fine\n\n- "a"\n- \'b\'\n\n> "q"');
    expect(html).toContain("He said \u201chi <em>there</em>\u201d \u2014 it\u2019s fine");
    expect(html).toContain("<li>\u201ca\u201d</li>");
    expect(html).toContain("<li>\u2018b\u2019</li>");
    expect(html).toContain("\u201cq\u201d");
    // Whole-tree smartypants took ~2.5s here (quadratic); bounded it is ~100ms.
    const start = performance.now();
    renderRichContent('word "w" '.repeat(20_000));
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("treats Object.prototype names as unknown directives and languages", () => {
    const html = renderRichContentToHtml(":::constructor\nbody\n:::\n\n```constructor\nx\n```");
    expect(html).toContain("<p>body</p>");
    expect(html).toContain('data-lang="constructor"');
  });

  it("stops syntax highlighting past the per-render budget", () => {
    let chars = 0;
    const highlighter = {
      supports: () => true,
      highlight: (code: string) => {
        chars += code.length;
        return null;
      },
    };
    const block = "```js\n" + "x".repeat(5000) + "\n```\n\n";
    renderRichContent(block.repeat(10), { highlighter });
    expect(chars).toBeLessThanOrEqual(HIGHLIGHT_CHAR_BUDGET);
    expect(chars).toBeGreaterThan(0);
  });
});

describe("v4 blocks – math", () => {
  const math = createMathRenderer();

  it("renders $$ blocks and ```math fences as MathML, keeping single $ literal", () => {
    const md = "Costs $5 and $10.\n\n$$\nx^2\n$$\n\n```math\n\\frac{a}{b}\n```\n\nInline $$e=mc^2$$ too.";
    const html = renderRichContentToHtml(md, { math });
    expect(html).toContain("Costs $5 and $10.");
    expect(html.match(/<div class="vc-math" data-vc-math="block"><math/g)).toHaveLength(2);
    expect(html).toContain('display="block"');
    expect(html).toContain('<span class="vc-math-inline"><math');
    expect(html).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
    expect(html).not.toContain("katex");
  });

  it("uses the highlighter's bundled math renderer by default", () => {
    const html = renderRichContentToHtml("$$\nx\n$$", { highlighter: createCodeHighlighter() });
    expect(html).toContain("<math");
  });

  it("falls back to framed source without a renderer, and to <pre> in feeds", () => {
    const md = "$$\nx^2\n$$";
    const plain = renderRichContent(md);
    expect(plain.warnings).toEqual([]);
    expect(renderRichContentToHtml(md)).toContain('data-lang="math"');
    const feed = renderRichContentToHtml(md, { math, target: "feed" });
    expect(feed).toContain('<pre><code class="language-math">x^2</code></pre>');
    expect(feed).not.toContain("<math");
  });

  it("shows pathologically nested TeX as source instead of overflowing SSR", () => {
    const md = "$$\n" + "\\overline{".repeat(500) + "x" + "}".repeat(500) + "\n$$";
    const r = renderRichContent(md, { math });
    expect(r.warningCodes).toContain(RENDER_WARNING.MATH_INVALID);
    expect(() => renderToStaticMarkup(r.node as React.ReactElement)).not.toThrow();
  });

  it("renders realistic nested formulas normally", () => {
    const tex = "\\frac{1}{1+\\frac{1}{1+\\frac{1}{1+\\frac{1}{1+\\sqrt{\\sum_{i=1}^{n} x_i^{2^{k}}}}}}}";
    const r = renderRichContent(`$$\n${tex}\n$$`, { math });
    expect(r.warningCodes).toEqual([]);
  });

  it("warns on invalid TeX and keeps the source", () => {
    const r = renderRichContent("$$\n\\frac{a\n$$", { math });
    expect(r.warningCodes).toEqual([RENDER_WARNING.MATH_INVALID]);
    expect(renderRichContentToHtml("$$\n\\frac{a\n$$", { math })).toContain("\\frac{a");
  });

  it("is untrusted: no links, no macro bombs", () => {
    const html = renderRichContentToHtml("$$\n\\href{javascript:alert(1)}{x} \\url{javascript:y}\n$$", { math });
    expect(html).not.toMatch(/href="javascript/);
    const start = performance.now();
    const bomb = renderRichContent("$$\n\\def\\a{\\a\\a}\\a\n$$\n\n$$\n\\rule{1000em}{1000em}\n$$", { math });
    expect(performance.now() - start).toBeLessThan(500);
    expect(bomb.warningCodes).toContain(RENDER_WARNING.MATH_INVALID);
  });

  it("caps rendered TeX per post and warns once", () => {
    let chars = 0;
    const counting: MathRenderer = {
      render: (tex) => {
        chars += tex.length;
        return { nodes: [] };
      },
    };
    const block = "$$\n" + "x".repeat(1000) + "\n$$\n\n";
    const r = renderRichContent(block.repeat(30), { math: counting });
    expect(chars).toBeLessThanOrEqual(MATH_CHAR_BUDGET);
    expect(r.warningCodes.filter((c) => c === RENDER_WARNING.MATH_TOO_LARGE)).toHaveLength(1);
  });
});

describe("v4 blocks – math hardening", () => {
  const math = createMathRenderer();

  it("refuses user macro definitions (expansion amplification)", () => {
    // 9 KB of TeX used to expand to ~8.5 MB of MathML in one block.
    const start = performance.now();
    for (const def of ["\\def\\a", "\\gdef\\a", "\\edef\\a", "\\newcommand{\\a}", "\\renewcommand\\a", "\\let\\a"]) {
      const md = "$$\n" + def + "{" + "x".repeat(9000) + "}" + "\\a".repeat(95) + "\n$$";
      const r = renderRichContent(md, { math });
      expect(r.warningCodes, def).toEqual([RENDER_WARNING.MATH_INVALID]);
      expect(renderRichContentToHtml(md, { math }).length, def).toBeLessThan(20_000);
    }
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("allows the builtin macro expansions real formulas need", () => {
    const r = renderRichContent("$$\n" + "a \\neq b, 1,\\dots,n ".repeat(60) + "\n$$", { math });
    expect(r.warnings).toEqual([]);
    expect(math.render("\\definecolor", false)).toHaveProperty("error");
    expect(math.render("\\delta \\left( x \\right) \\leq \\lvert y \\rvert", false)).toHaveProperty("nodes");
  });
});

describe("v4 blocks – mermaid", () => {
  const md = "```mermaid\ngraph TD\n  A-->B<script>\n```";

  it("emits a figure with the escaped source for blocks.js", () => {
    const html = renderRichContentToHtml(md);
    expect(html).toContain(
      '<figure class="vc-diagram" data-vc-diagram="mermaid"><pre class="vc-diagram-source" data-vc-mermaid="true">graph TD\n  A--&gt;B&lt;script&gt;</pre></figure>',
    );
  });

  it("keeps plain source in feeds and caps diagram size", () => {
    expect(renderRichContentToHtml(md, { target: "feed" })).toContain('<pre><code class="language-mermaid">');
    const big = renderRichContent("```mermaid\n" + "A-->B\n".repeat(MERMAID_MAX_CHARS / 5) + "```");
    expect(big.warningCodes).toEqual([RENDER_WARNING.DIAGRAM_TOO_LARGE]);
    expect(renderRichContentToHtml("```mermaid\n" + "A-->B\n".repeat(MERMAID_MAX_CHARS / 5) + "```")).not.toContain(
      "data-vc-mermaid",
    );
  });

  it("raw HTML cannot forge a diagram", () => {
    expect(renderRichContentToHtml('<pre data-vc-mermaid="true">x</pre>')).not.toContain("data-vc-mermaid");
  });
});

describe("v4 blocks – heading ids and toc markers", () => {
  it("keeps pre-typography heading anchors while smartening the visible text", () => {
    const result = renderRichContent("## API -- usage\n\n## API -- usage\n\n## Custom -- usage {#fixed}");
    expect(result.outline.map((entry) => entry.id)).toEqual(["h-api----usage", "h-api----usage-1", "h-fixed"]);
    expect(renderRichContentToHtml("## API -- usage")).toContain("API — usage");
  });

  it("bounds raw HTML and deeply nested Markdown without throwing", () => {
    const raw = "<div>".repeat(2000) + "Hi" + "</div>".repeat(2000);
    expect(renderRichContent(raw).warningCodes).toContain(RENDER_WARNING.NESTING_LIMIT);
    expect(renderRichContentToHtml(raw)).toContain("&lt;div&gt;");
    const quotes = ">".repeat(5000) + " Hi";
    expect(renderRichContent(quotes).warningCodes).toContain(RENDER_WARNING.NESTING_LIMIT);
  });

  it("applies {#id} with the h- prefix and hides [!toc] headings from the outline", () => {
    const md = "## Setup {#setup}\n\n## Aside [!toc]\n\n### Both {#both} [!toc]\n\n### Other [!toc] {#other}";
    const r = renderRichContent(md);
    expect(r.outline).toEqual([{ depth: 2, text: "Setup", id: "h-setup" }]);
    const html = renderRichContentToHtml(md);
    expect(html).toContain('<h2 id="h-setup"><a href="#h-setup"');
    expect(html).toContain('id="h-aside"');
    expect(html).toContain('id="h-both"');
    expect(html).toContain('id="h-other"');
    expect(html).not.toMatch(/\{#|\[!toc\]|data-vc-toc/);
  });

  it("warns on invalid ids and dedupes collisions", () => {
    const bad = renderRichContent("## Bad {#Not OK!}");
    expect(bad.warningCodes).toEqual([RENDER_WARNING.HEADING_ID_INVALID]);
    expect(renderRichContentToHtml("## Bad {#Not OK!}")).toContain("{#Not OK!}");
    const dup = renderRichContent("## A {#x}\n\n## B {#x}\n\n## x");
    expect(dup.outline.map((h) => h.id)).toEqual(["h-x", "h-x-1", "h-x-2"]);
    expect(dup.warningCodes).toContain(RENDER_WARNING.HEADING_ID_DUPLICATE);
  });

  it("dedupes many repeated custom ids in linear time, warning once per id", () => {
    const start = performance.now();
    const r = renderRichContent("## X {#a}\n\n".repeat(12_000));
    expect(performance.now() - start).toBeLessThan(2500);
    const ids = r.outline.map((h) => h.id);
    expect(new Set(ids).size).toBe(12_000);
    expect(ids.slice(0, 3)).toEqual(["h-a", "h-a-1", "h-a-2"]);
    expect(r.warningCodes).toEqual([RENDER_WARNING.HEADING_ID_DUPLICATE]);
  });

  it("raw HTML cannot hide headings or mint ids", () => {
    const r = renderRichContent('<h2 data-vc-toc="hide" id="evil">Raw</h2>');
    expect(r.outline).toEqual([{ depth: 2, text: "Raw", id: "h-raw" }]);
  });

  it("anchors h5/h6 too", () => {
    const html = renderRichContentToHtml("##### Five\n\n###### Six");
    expect(html).toContain('<h5 id="h-five"><a href="#h-five" class="vc-heading-anchor"');
    expect(html).toContain('<h6 id="h-six"><a href="#h-six" class="vc-heading-anchor"');
  });

  it("parses markers in linear time", () => {
    const start = performance.now();
    parseHeadingMarkers("a" + " ".repeat(200_000) + "{#x");
    parseHeadingMarkers("{#".repeat(100_000) + "}");
    expect(performance.now() - start).toBeLessThan(200);
    expect(parseHeadingMarkers("Title {#t}")).toEqual({ text: "Title", id: "t", hide: false, invalidId: undefined });
  });
});

describe("v4 blocks – code", () => {
  it("highlights words and honors marker counts", () => {
    const md = "```ts\n// [!code word:cms]\nconst cms = 1; // [!code highlight:2]\nuse(cms);\n// [!code ++:2]\na();\nb();\nc(cms);\n```";
    const html = renderRichContentToHtml(md);
    expect(html).not.toContain("[!code");
    expect(html.match(/<span class="vc-code-word">cms<\/span>/g)).toHaveLength(3);
    expect(html.match(/data-highlighted="true"/g)).toHaveLength(2);
    expect(html.match(/data-diff="add"/g)).toHaveLength(2);
    expect(html).toContain('<span class="line">c(<span class="vc-code-word">cms</span>);</span>');
  });

  it("bounds [!code word:] work on adversarial blocks", () => {
    // Every line declaring a word used to cost lines x words markWord passes (~5s here).
    const start = performance.now();
    renderRichContent("```\n" + "a // [!code word:a]\n".repeat(20_000) + "```");
    renderRichContent("```\n" + "// [!code word:a]\nb\n".repeat(10_000) + "```");
    expect(performance.now() - start).toBeLessThan(1500);
    const { words } = applyCodeNotation("x // [!code word:x]\n".repeat(100));
    expect(words.length).toBeLessThanOrEqual(32);
  });

  it("limits word marks to :N lines", () => {
    const { words, code } = applyCodeNotation("// [!code word:x:1]\nx\nx");
    expect(code).toBe("x\nx");
    expect(words).toEqual([{ word: "x", from: 1, to: 1 }]);
  });

  it("highlights inline code with a {:lang} suffix through the shared budget", () => {
    const html = renderRichContentToHtml("Call `fetch(url){:ts}` now.", { highlighter: createCodeHighlighter() });
    expect(html).toContain('<code class="vc-shiki-inline" data-lang="ts"><span style="--shiki-light:');
    expect(html).not.toContain("{:ts}");
    expect(renderRichContentToHtml("Call `fetch(url){:ts}`.")).toContain("<code>fetch(url)</code>");
    expect(renderRichContentToHtml("`{:ts}` alone")).toContain("<code>{:ts}</code>");

    let chars = 0;
    const highlighter = {
      supports: () => true,
      highlight: (code: string) => {
        chars += code.length;
        return null;
      },
    };
    renderRichContent(("`" + "x".repeat(900) + "{:js}` ").repeat(40), { highlighter });
    expect(chars).toBeLessThanOrEqual(HIGHLIGHT_CHAR_BUDGET);
  });

  it("wraps long lines with the wrap meta flag", () => {
    expect(parseCodeMeta("wrap").wrap).toBe(true);
    expect(parseCodeMeta("wrap").title).toBeUndefined();
    expect(renderRichContentToHtml("```ts app.ts wrap\nx\n```")).toMatch(/data-wrap="true"/);
    expect(renderRichContentToHtml("```ts app.ts wrap\nx\n```")).toContain("vc-code-frame-title\">app.ts<");
  });
});

describe("v4 blocks – steps and tabs", () => {
  it("renders :::steps from a list or headings", () => {
    const flat = (md: string, o?: Parameters<typeof renderRichContentToHtml>[1]) =>
      renderRichContentToHtml(md, o).replace(/\n/g, "");
    const list = flat(":::steps\n- one\n- two\n:::");
    expect(list).toContain('<ol class="vc-steps"><li>one</li><li>two</li></ol>');
    const headings = flat(":::steps\nIntro.\n\n### One\n\nA.\n\n### Two\n\nB.\n:::");
    expect(headings).toContain("<p>Intro.</p>");
    expect(headings).toMatch(/<ol class="vc-steps"><li><h3 id="h-one">.*<\/h3><p>A.<\/p><\/li><li><h3 id="h-two">/);
    expect(flat(":::steps\n1. a\n:::", { target: "feed" })).toContain("<ol><li>a</li></ol>");
    expect(renderRichContent(":::steps\njust text\n:::").warningCodes).toEqual([RENDER_WARNING.STEPS_INVALID]);
  });

  it("renders labelled tab stacks that read without JS", () => {
    const md = "::::tabs\n:::tab[pnpm]\nUse pnpm.\n:::\n:::tab[npm]\nUse npm.\n:::\n::::";
    const html = renderRichContentToHtml(md);
    expect(html).toContain(
      '<div class="vc-tabs" data-vc-tabs=""><section class="vc-tab" data-vc-tab="pnpm"><p class="vc-tab-label">pnpm</p><p>Use pnpm.</p></section><section class="vc-tab" data-vc-tab="npm">',
    );
    expect(renderRichContentToHtml(md, { target: "feed" })).toContain(
      "<p><strong>pnpm</strong></p><p>Use pnpm.</p><p><strong>npm</strong></p><p>Use npm.</p>",
    );
  });

  it("warns on stray tab content and lone tabs", () => {
    const r = renderRichContent("::::tabs\nloose\n:::tab[a]\nx\n:::\n::::\n\n:::tab[b]\ny\n:::");
    expect(r.warningCodes).toEqual([RENDER_WARNING.TABS_INVALID, RENDER_WARNING.DIRECTIVE_UNKNOWN]);
    const html = renderRichContentToHtml("::::tabs\nloose\n:::tab[a]\nx\n:::\n::::").replace(/\n/g, "");
    expect(html).toContain('<p>loose</p><div class="vc-tabs"');
  });

  it("turns :::code-group fences into code tabs labelled by title", () => {
    const md = ':::code-group\n```ts title="a.ts" {1}\nconst a = 1\n```\n```js [b.js]\nconst b = 2\n```\n```sh\nls\n```\n:::';
    const html = renderRichContentToHtml(md);
    expect(html).toContain('data-vc-tabs="code"');
    expect(html).toContain('data-vc-tab="a.ts"');
    expect(html).toContain('data-vc-tab="b.js"');
    expect(html).toContain('data-vc-tab="sh"');
    expect(html).not.toContain("vc-code-frame-title");
    expect(html).toContain('<span class="line" data-highlighted="true">const a = 1</span>');
  });

  it("expands ```package-install into package-manager tabs", () => {
    const html = renderRichContentToHtml("```package-install\nnpm i -D @vc/cli\n```");
    for (const cmd of ["npm install -D @vc/cli", "pnpm add -D @vc/cli", "yarn add -D @vc/cli", "bun add -d @vc/cli"]) {
      expect(html).toContain(`<span class="line">${cmd}</span>`);
    }
    expect(installCommand("npx create-vibe", "pnpm")).toBe("pnpm dlx create-vibe");
    expect(installCommand("npx -y create-vibe", "bun")).toBe("bunx create-vibe");
    expect(installCommand("npm install -g vibe", "yarn")).toBe("yarn global add vibe");
    expect(installCommand("npm run build", "bun")).toBe("bun run build");
    expect(installCommand("react react-dom", "npm")).toBe("npm install react react-dom");
    expect(installCommand("npm i", "yarn")).toBe("yarn");
  });

  it("shows the complete original package-install block when expansion would truncate commands", () => {
    for (const commands of [Array.from({ length: 21 }, (_, i) => `npm i package-${i}`).join("\n"), `npm i ${"x".repeat(510)}`]) {
      const markdown = `\`\`\`package-install\n${commands}\n\`\`\``;
      const result = renderRichContent(markdown);
      expect(result.warningCodes).toContain(RENDER_WARNING.PACKAGE_INSTALL_LIMIT);
      const html = renderRichContentToHtml(markdown);
      expect(html).toContain(commands.split("\n").at(-1)!);
      expect(html).not.toContain("vc-code-tabs");
    }
  });

  it("warns on a raw image missing alt outside a paragraph", () => {
    expect(renderRichContent('<img src="/photo.jpg">').warningCodes).toContain(RENDER_WARNING.IMAGE_MISSING_ALT);
  });

  it("raw HTML cannot forge generated blocks", () => {
    const html = renderRichContentToHtml('<div data-vc-block="tabs"><div data-vc-block="tab" data-vc-label="x">y</div></div>');
    expect(html).not.toContain("vc-tabs");
    expect(html).not.toContain("data-vc-block");
    expect(html).not.toContain("data-vc-label");
  });
});

describe("v4 blocks – images and tables", () => {
  it("turns an image title into a caption", () => {
    const html = renderRichContentToHtml('![A cat](/cat.png "Our cat")');
    expect(html).toContain('<figure data-captioned="true"><img src="/cat.png" alt="A cat"');
    expect(html).toContain("<figcaption>Our cat</figcaption>");
    expect(html).not.toContain('title="Our cat"');
  });

  it("drops a captioned dark-only image's caption from feeds too", () => {
    const md = '![D](/d.png#gh-dark-mode-only "Dark caption")\n\n![L](/l.png#gh-light-mode-only "Light caption")';
    const feed = renderRichContentToHtml(md, { target: "feed" });
    expect(feed).not.toContain("Dark caption");
    expect(feed).not.toContain("/d.png");
    expect(feed).toContain("<figcaption>Light caption</figcaption>");
    expect(renderRichContentToHtml(md)).toContain("<figcaption>Dark caption</figcaption>");
  });

  it("maps GitHub color-scheme fragments to classes (dark dropped from feeds)", () => {
    const md = "![L](/l.png#gh-light-mode-only) ![D](/d.png#gh-dark-mode-only)";
    const html = renderRichContentToHtml(md);
    expect(html).toContain('src="/l.png" alt="L" class="vc-img-light"');
    expect(html).toContain('src="/d.png" alt="D" class="vc-img-dark"');
    const feed = renderRichContentToHtml(md, { target: "feed", baseUrl: "https://b.test/p" });
    expect(feed).toContain('src="https://b.test/l.png"');
    expect(feed).not.toContain("d.png");
  });

  it("plumbs resolver width/height and keeps the fragment out of the resolver", () => {
    const seen: string[] = [];
    const html = renderRichContentToHtml("![x](/media-assets/a#gh-dark-mode-only)", {
      resolveImage: (src) => {
        seen.push(src);
        return { src: `${src}?w=860`, width: 1200, height: 630 };
      },
    });
    expect(seen).toEqual(["/media-assets/a"]);
    expect(html).toContain('src="/media-assets/a?w=860" alt="x" width="1200" height="630"');
    expect(html).toContain('class="vc-img-dark"');
  });

  it("wraps tables in a focusable scroll region and drops empty headers", () => {
    const html = renderRichContentToHtml("|   |   |\n| - | - |\n| a | b |");
    expect(html).toContain(
      '<div class="vc-table-scroll" tabindex="0" role="region" aria-label="Table"><table><tbody><tr><td>a</td>',
    );
    expect(renderRichContentToHtml("| h |\n| - |\n| a |", { target: "feed" })).not.toContain("vc-table-scroll");
  });
});

describe("v4 agent contract – warning codes", () => {
  it("returns stable codes index-aligned with warnings", () => {
    const r = renderRichContent("![](/a.png)\n\n> [!WARN]\n> x\n\n<marquee>m</marquee>\n\n:::weird\nx\n:::");
    expect(r.warningCodes).toHaveLength(r.warnings.length);
    expect(r.warningCodes).toEqual([
      RENDER_WARNING.DIRECTIVE_UNKNOWN,
      RENDER_WARNING.HTML_REMOVED,
      RENDER_WARNING.IMAGE_MISSING_ALT,
      RENDER_WARNING.CALLOUT_UNKNOWN,
    ]);
    r.warnings.forEach((w, i) => expect(renderWarningCode(w)).toBe(r.warningCodes[i]));
  });

  it("classifies validateRichContent-only warnings", () => {
    const warnings = validateRichContent("```\nx\n```");
    expect(warnings.map(renderWarningCode)).toEqual([RENDER_WARNING.CODE_FENCE_NO_LANGUAGE]);
  });
});

describe("v4 kitchen sink", () => {
  it("renders every block without warnings, within budget", () => {
    const highlighter = createCodeHighlighter();
    const start = performance.now();
    const r = renderRichContent(BLOCKS_SAMPLE, { highlighter });
    expect(performance.now() - start).toBeLessThan(1500);
    expect(r.warnings).toEqual([]);
    const html = renderRichContentToHtml(BLOCKS_SAMPLE, { highlighter });
    for (const marker of [
      "vc-math",
      "vc-math-inline",
      "data-vc-mermaid",
      'id="h-markers"',
      "vc-code-word",
      "vc-shiki-inline",
      'data-wrap="true"',
      'class="vc-steps"',
      'data-vc-tabs=""',
      'data-vc-tabs="code"',
      'data-vc-tab="bun"',
      "<figcaption>",
      "vc-img-dark",
      "vc-table-scroll",
    ]) {
      expect(html, marker).toContain(marker);
    }
    expect(r.outline.some((h) => h.text.includes("Hidden"))).toBe(false);
    const feed = renderRichContentToHtml(BLOCKS_SAMPLE, { target: "feed", baseUrl: "https://b.test/p" });
    expect(feed).not.toMatch(/vc-tabs|vc-steps|vc-table-scroll|data-vc-(?!theme)/);
  });
});

describe("nesting guard ignores code", () => {
  it("renders a post with many generics in code normally", () => {
    const generics = Array.from({ length: 200 }, (_, i) => `\`Promise<User${i}>\``).join(" ");
    const fenced = "```ts\n" + Array.from({ length: 200 }, () => "const a: Map<Key>").join("\n") + "\n```";
    const result = renderRichContent(`# Types\n\n${generics}\n\n${fenced}\n`);
    expect(result.warningCodes).not.toContain(RENDER_WARNING.NESTING_LIMIT);
  });
});

describe("nesting guard false positives", () => {
  it("does not treat implicitly closed paragraphs as nesting", () => {
    const r = renderRichContent(Array.from({ length: 150 }, (_, i) => `<p>para ${i}`).join("\n"));
    expect(r.warningCodes).not.toContain(RENDER_WARNING.NESTING_LIMIT);
  });

  it("ignores deep quote markers inside fenced code", () => {
    const r = renderRichContent("```text\n" + ">".repeat(200) + "\n```\n");
    expect(r.warningCodes).not.toContain(RENDER_WARNING.NESTING_LIMIT);
  });

  it("never falls back for HTML that is only code", () => {
    const divs = "<div>".repeat(150);
    for (const source of [
      `    ${divs}\n`,
      `> \`\`\`html\n> ${divs}\n> \`\`\`\n`,
      `Inline \`${divs}\nstill code\` here.\n`,
    ]) {
      expect(renderRichContent(source).warningCodes).not.toContain(RENDER_WARNING.NESTING_LIMIT);
    }
  });

  it("treats <div/> as an open tag, like browsers do", () => {
    const r = renderRichContent("<div/>".repeat(1500) + "x");
    expect(r.warningCodes).toContain(RENDER_WARNING.NESTING_LIMIT);
  });

  it("degrades very deep Markdown quotes instead of throwing", () => {
    const r = renderRichContent(">".repeat(5000) + " deep");
    expect(r.warningCodes).toContain(RENDER_WARNING.NESTING_LIMIT);
  });

  it("still falls back on genuinely deep HTML", () => {
    const r = renderRichContent("<div>".repeat(2000) + "Hi" + "</div>".repeat(2000));
    expect(r.warningCodes).toContain(RENDER_WARNING.NESTING_LIMIT);
  });
});

describe("heading ids stay compatible", () => {
  it("ignores inline HTML tags when slugging", () => {
    const r = renderRichContent("## Hello <em>world</em>\n\ntext");
    expect(r.outline[0]?.id).toBe("h-hello-world");
  });
});
