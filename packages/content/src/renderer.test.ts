import { describe, it, expect, beforeAll } from "vitest";
import {
  renderRichContent,
  renderRichContentToHtml,
  validateRichContent,
  RENDERER_VERSION,
  applyCodeNotation,
  parseCodeMeta,
  HIGHLIGHT_CHAR_BUDGET,
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

  it("exports renderer version 3", () => {
    expect(RENDERER_VERSION).toBe("3");
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
