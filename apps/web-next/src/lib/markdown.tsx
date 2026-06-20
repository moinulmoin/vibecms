/**
 * Rich Markdown rendering pipeline for VibeCMS.
 *
 * Pipeline: remark-parse → remark-gfm → remark-rehype →
 *   rehype-slug → external-link rel → TOC collector →
 *   captioned-image transform → GitHub callouts →
 *   code-lang extractor → rehype-sanitize → rehype-react
 *
 * All transforms are synchronous (processSync); safe for Workers SSR.
 * XSS-safe: rehype-sanitize is LAST; never enables allowDangerousHtml.
 */
import { type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeReact from "rehype-react";
import styles from "../components/public-blog.module.css";

/** Renderer pipeline version - import from here for a single source of truth. */
export const RENDERER_VERSION = '1';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface OutlineEntry {
  readonly depth: number;
  readonly text: string;
  readonly id: string;
}

export interface RenderResult {
  readonly node: ReactNode;
  readonly outline: OutlineEntry[];
  readonly warnings: string[];
}

export interface RenderOpts {
  readonly presetId?: string;
}

// ─── Internal HAST-compatible node types ─────────────────────────────────────
//
// `hast` is not a direct dep so we define structurally-equivalent shapes here.
// `UnistNode` matches `@types/unist` Node structurally; used as transformer
// parameter to satisfy unified's contravariant Plugin<> constraint.

type UnistNode = { type: string; [key: string]: unknown };

interface HText {
  readonly type: "text";
  value: string;
}
interface HElement {
  readonly type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HNode[];
}
interface HRoot {
  readonly type: "root";
  children: HNode[];
}
type HNode = HText | HElement | { readonly type: string };

function isEl(n: HNode): n is HElement {
  return n.type === "element";
}
function isTxt(n: HNode): n is HText {
  return n.type === "text";
}
function isElTag(n: HNode, tag: string): n is HElement {
  return isEl(n) && n.tagName === tag;
}
function isBlankTxt(n: HNode): boolean {
  return isTxt(n) && n.value.trim() === "";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Concatenate all text content in a HAST subtree. */
function hastToText(node: HNode | HRoot): string {
  if (isTxt(node as HNode)) return (node as HText).value;
  const children = ("children" in node ? (node as HRoot | HElement).children : null) ?? [];
  return children.map((c) => hastToText(c as HNode)).join("");
}

/** Depth-first walk; fn called for each element before its descendants. */
function walkEl(
  children: HNode[],
  fn: (el: HElement, i: number, siblings: HNode[]) => void,
): void {
  for (let i = 0; i < children.length; i++) {
    const n = children[i];
    if (!isEl(n)) continue;
    fn(n, i, children);
    walkEl(n.children, fn);
  }
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Plugin: add rel to external links ───────────────────────────────────────

function rehypeExternalLinks(): (tree: UnistNode) => void {
  return (tree) => {
    // HAST Root is provided at this pipeline position
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el) => {
      if (el.tagName !== "a") return;
      const href = el.properties.href;
      if (typeof href === "string" && /^https?:\/\//i.test(href)) {
        el.properties.rel = ["nofollow", "noopener", "noreferrer"];
      }
    });
  };
}

// ─── Plugin: TOC collector + [[toc]] replacement ─────────────────────────────

interface TocPluginOpts {
  readonly outline: OutlineEntry[];
  readonly warnings: string[];
}

function rehypeTocCollector(opts: TocPluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    // HAST Root is provided at this pipeline position
    const root = tree as unknown as HRoot;

    // Collect h2/h3 headings (rehype-slug already populated their ids)
    walkEl(root.children, (el) => {
      if (el.tagName !== "h2" && el.tagName !== "h3") return;
      const depth = Number(el.tagName[1]);
      const text = hastToText(el);
      const id = typeof el.properties.id === "string" ? el.properties.id : "";
      opts.outline.push({ depth, text, id });
    });

    // Replace [[toc]] paragraph in place
    function replaceToc(children: HNode[]): void {
      for (let i = 0; i < children.length; i++) {
        const n = children[i];
        if (!isEl(n)) continue;

        if (isElTag(n, "p") && hastToText(n).trim() === "[[toc]]") {
          if (opts.outline.length === 0) {
            opts.warnings.push(
              "[[toc]] marker present but no H2 or H3 headings found - TOC omitted",
            );
            children.splice(i, 1);
            i--;
          } else {
            const nav: HElement = {
              type: "element",
              tagName: "nav",
              properties: { dataToc: true },
              children: [
                {
                  type: "element",
                  tagName: "ul",
                  properties: {},
                  children: opts.outline.map<HNode>((h) => ({
                    type: "element",
                    tagName: "li",
                    properties: {},
                    children: [
                      {
                        type: "element",
                        tagName: "a",
                        properties: { href: `#${h.id}` },
                        children: [{ type: "text", value: h.text }],
                      },
                    ],
                  })),
                },
              ],
            };
            children[i] = nav;
          }
          continue;
        }

        replaceToc(n.children);
      }
    }

    replaceToc(root.children);
  };
}

// ─── Plugin: captioned images → <figure data-captioned> ──────────────────────

interface ImgPluginOpts {
  readonly warnings: string[];
}

function rehypeCaptionedImages(opts: ImgPluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    // HAST Root is provided at this pipeline position
    const root = tree as unknown as HRoot;

    function hasEmptyAlt(img: HElement): boolean {
      const a = img.properties.alt;
      return !a || (typeof a === "string" && !a.trim());
    }

    function transform(children: HNode[]): void {
      // Recurse into non-paragraph block elements first (bottom-up)
      for (const child of children) {
        if (isEl(child) && child.tagName !== "p") {
          transform(child.children);
        }
      }

      let i = 0;
      while (i < children.length) {
        const curr = children[i];
        if (!isEl(curr) || !isElTag(curr, "p")) {
          i++;
          continue;
        }

        const sig = curr.children.filter((c) => !isBlankTxt(c));

        // Case A: paragraph contains ONLY one img -> plain image (alt-checked).
        // Per the v1 grammar, a blank line before a caption yields a plain image, not a figure.
        const isImgOnly = sig.length === 1 && isEl(sig[0]) && isElTag(sig[0], "img");

        // Case B: paragraph contains img followed immediately by em element(s)
        // (adjacent-line: !\[img\]\n*caption* → CommonMark puts both in one <p>)
        const isImgWithCaption =
          sig.length >= 2 &&
          isEl(sig[0]) && isElTag(sig[0], "img") &&
          sig.slice(1).every((c) => isEl(c) && isElTag(c, "em"));

        if (isImgOnly) {
          const imgEl = sig[0] as HElement;
          if (hasEmptyAlt(imgEl)) opts.warnings.push("Image is missing alt text");
        } else if (isImgWithCaption) {
          // Adjacent-line pattern: img + em(s) in the same paragraph
          const imgEl = sig[0] as HElement;
          const captionEms = sig.slice(1) as HElement[];
          if (hasEmptyAlt(imgEl)) opts.warnings.push("Image is missing alt text");

          children[i] = {
            type: "element",
            tagName: "figure",
            properties: { dataCaptioned: true },
            children: [
              imgEl,
              { type: "element", tagName: "figcaption", properties: {}, children: captionEms },
            ],
          } as HElement;
          // Don't splice; the figure replaces the paragraph, i stays; next iteration skips figure (not "p")
        } else {
          // Warn on inline images with empty alt (not the primary img of this paragraph)
          for (const child of curr.children) {
            if (isEl(child) && isElTag(child, "img") && hasEmptyAlt(child)) {
              opts.warnings.push("Image is missing alt text");
            }
          }
        }

        i++;
      }
    }

    transform(root.children);
  };
}

// ─── Plugin: GitHub-style callouts → <aside class="vc-callout"> ──────────────

const CALLOUT_KNOWN = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
type CalloutKind = (typeof CALLOUT_KNOWN)[number];

const CALLOUT_LABEL: Record<CalloutKind, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

function isKnownCallout(s: string): s is CalloutKind {
  return (CALLOUT_KNOWN as readonly string[]).includes(s);
}

/**
 * Strip the [!TYPE] marker from the start of a paragraph's children array.
 * Returns the cleaned children array, or null if the paragraph becomes empty.
 * Preserves inline elements (bold, links) that follow the marker.
 */
function stripCalloutMarker(children: HNode[], marker: string): HNode[] | null {
  const result = [...children];
  const re = new RegExp(`^\\s*${escRe(marker)}[ \\t]*\\n?[ \\t]*`);

  for (let i = 0; i < result.length; i++) {
    const child = result[i];
    if (!isTxt(child)) break; // marker not in leading text node
    const cleaned = child.value.replace(re, "");
    if (cleaned !== child.value) {
      if (cleaned) result[i] = { type: "text", value: cleaned };
      else result.splice(i, 1);
      break;
    }
  }

  const hasContent = result.some((c) => !isTxt(c) || c.value.trim() !== "");
  return hasContent ? result : null;
}

interface CalloutPluginOpts {
  readonly warnings: string[];
}

function rehypeCallouts(opts: CalloutPluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    // HAST Root is provided at this pipeline position
    const root = tree as unknown as HRoot;

    function transform(children: HNode[]): void {
      for (let i = 0; i < children.length; i++) {
        const n = children[i];
        if (!isEl(n)) continue;

        if (n.tagName !== "blockquote") {
          transform(n.children);
          continue;
        }

        const pIdx = n.children.findIndex((c) => isEl(c) && isElTag(c, "p"));
        if (pIdx === -1) {
          transform(n.children);
          continue;
        }

        const firstP = n.children[pIdx] as HElement;
        const text = hastToText(firstP).trimStart();
        const match = /^\[!([A-Za-z]+)\]/.exec(text);
        if (!match) {
          transform(n.children);
          continue;
        }

        const rawType = match[1].toUpperCase();
        if (!isKnownCallout(rawType)) {
          opts.warnings.push(
            `Unknown callout type "[!${match[1]}]" - rendered as plain blockquote`,
          );
          transform(n.children);
          continue;
        }

        const marker = match[0];
        const label = CALLOUT_LABEL[rawType];
        const cleanedChildren = stripCalloutMarker(firstP.children, marker);
        const otherChildren = n.children.filter((_, idx) => idx !== pIdx);

        const contentChildren: HNode[] = cleanedChildren
          ? [{ ...firstP, children: cleanedChildren } as HElement, ...otherChildren]
          : otherChildren;

        const aside: HElement = {
          type: "element",
          tagName: "aside",
          properties: { className: ["vc-callout"], dataCallout: rawType.toLowerCase() },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["vc-callout-label"] },
              children: [{ type: "text", value: label }],
            },
            ...contentChildren,
          ],
        };

        children[i] = aside;
        // Transform aside content children (skip the label span at index 0)
        transform(aside.children);
      }
    }

    transform(root.children);
  };
}

// ─── Plugin: extract code language from className → data-lang on <pre> ────────

function rehypeCodeLang(): (tree: UnistNode) => void {
  return (tree) => {
    // HAST Root is provided at this pipeline position
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el) => {
      if (el.tagName !== "pre") return;
      const code = el.children.find((c) => isEl(c) && isElTag(c, "code")) as
        | HElement
        | undefined;
      if (!code) return;
      const classes = (code.properties.className as string[] | undefined) ?? [];
      const langClass = classes.find((c) => c.startsWith("language-"));
      if (langClass) el.properties.dataLang = langClass.slice("language-".length);
    });
  };
}

// ─── Sanitize schema ──────────────────────────────────────────────────────────
//
// Extends defaultSchema (hast-util-sanitize) with:
//   • aside, figure, figcaption, nav as allowed elements
//   • per-element attribute allowlists using HAST camelCase property names
//   • value-restricted className for callout/label elements
//   • data-* attributes for styling hooks
//   • rel on <a> for external-link safety
//   • loading/decoding on <img>

const sanitizeSchema = {
  ...defaultSchema,
  // clobberPrefix: '' keeps heading ids as the raw 'h-{slug}' that rehype-slug emits,
  // so the [[toc]] anchor links (#h-{slug}) resolve. DOM clobbering is mitigated by
  // that 'h-' prefix (e.g. '## Constructor' -> id='h-constructor', which cannot shadow
  // window.constructor), and raw-HTML ids are impossible (allowDangerousHtml:false).
  clobberPrefix: "",
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "aside",
    "figure",
    "figcaption",
    "nav",
  ],
  attributes: {
    ...defaultSchema.attributes,
    // Callout container: only allow the specific class + kind attribute
    aside: [["className", "vc-callout"], "dataCallout"] as [string, string][],
    // Captioned image wrapper
    figure: ["dataCaptioned"],
    // Caption text; inherits global attrs only
    figcaption: [] as string[],
    // TOC nav; only the marker attribute
    nav: ["dataToc"],
    // Code blocks: language label for future highlighting hooks
    pre: [...(defaultSchema.attributes?.pre ?? []), "dataLang"],
    // <code> keeps language className (default allows /^language-./; we leave it)
    code: defaultSchema.attributes?.code ?? [],
    // Callout label span: only allow the specific class
    span: [["className", "vc-callout-label"]] as [string, string][],
    // External link safety rel (not in defaultSchema.a)
    a: [...(defaultSchema.attributes?.a ?? []), "rel"],
    // Modern image performance attributes
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "decoding"],
  },
};

// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Render Markdown to a React node plus structured metadata.
 * Synchronous; safe for Workers SSR (processSync, no async plugins).
 */
export function renderRichContent(markdown: string, _opts?: RenderOpts): RenderResult {
  const outline: OutlineEntry[] = [];
  const warnings: string[] = [];

  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug, { prefix: "h-" })
    .use(rehypeExternalLinks)
    .use(rehypeTocCollector, { outline, warnings })
    .use(rehypeCaptionedImages, { warnings })
    .use(rehypeCallouts, { warnings })
    .use(rehypeCodeLang)
    .use(rehypeSanitize, sanitizeSchema as Parameters<typeof rehypeSanitize>[0])
    .use(rehypeReact, { Fragment, jsx, jsxs })
    .processSync(markdown);

  // rehype-react stores the JSX element in file.result
  const node = file.result as unknown as ReactNode;
  return { node, outline, warnings };
}

// ─── Shared render frame ──────────────────────────────────────────────────────

/**
 * Stable wrapper used by ALL surfaces (public blog, editor preview, posts.preview).
 * CSS token values are defined per-preset in the 015 wave; this element is the
 * theming root that CSS variables cascade from.
 */
export function RichContentFrame({
  node,
  presetId,
  mode,
}: {
  node: ReactNode;
  presetId?: string;
  mode?: 'light' | 'dark' | 'system';
}) {
  return (
    <div
      className={styles.markdown}
      data-rich-content=""
      data-vc-theme={presetId ?? "minimal"}
      {...(mode === 'light' || mode === 'dark' ? { 'data-vc-mode': mode } : {})}
    >
      {node}
    </div>
  );
}

// ─── Server-side HTML serialization ──────────────────────────────────────────

/**
 * Render Markdown to a static HTML string (for posts.preview REST/MCP tool).
 * Wraps the output in RichContentFrame so the HTML matches the live render.
 */
export function renderRichContentToHtml(markdown: string, opts?: RenderOpts): string {
  const { node } = renderRichContent(markdown, opts);
  return renderToStaticMarkup(
    <RichContentFrame node={node} presetId={opts?.presetId} />,
  );
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Return non-fatal content warnings. Never blocks publish.
 *
 * Rules checked:
 *   • Unknown callout type
 *   • [[toc]] present but no H2/H3
 *   • Post > 600 words with no [[toc]]
 *   • Code fence missing language identifier
 *   • Image missing alt text
 */
export function validateRichContent(markdown: string): string[] {
  const { warnings } = renderRichContent(markdown);

  // Long post without TOC
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;
  if (wordCount > 600 && !markdown.includes("[[toc]]")) {
    warnings.push(
      "Post has more than 600 words but no [[toc]] marker - consider adding a table of contents",
    );
  }

  // Code fence without language
  if (/^```[ \t]*\r?\n/m.test(markdown)) {
    warnings.push("One or more code fences are missing a language identifier (e.g. ` ```js `)");
  }

  return warnings;
}

// ─── Backward-compatible exports ──────────────────────────────────────────────

/**
 * Backward-compatible wrapper around renderRichContent.
 * Returns the node wrapped in an array so existing call-sites
 * that spread into JSX children continue to work.
 *
 * Prefer renderRichContent() for new code.
 */
export function parseMarkdown(source: string): ReactNode[] {
  return [renderRichContent(source).node];
}

/**
 * Restrict link hrefs to safe schemes. Exported for backward compatibility;
 * the unified pipeline also enforces URL safety via rehype-sanitize protocols.
 */
export function safeHref(raw: string): string {
  const href = raw.trim();
  if (href.startsWith("//")) return "#";
  if (href.startsWith("/") || href.startsWith("#")) return href;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return "#";
}
