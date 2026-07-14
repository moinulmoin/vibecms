/**
 * Rich Markdown rendering pipeline for VibeCMS (@vc/content).
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
import type {
  OutlineEntry,
  RenderOpts,
  RenderResult,
  RichContentFrameProps,
  ValidateRichContentOpts,
} from "./types.js";

export const RENDERER_VERSION = "2";

export type { OutlineEntry, RenderOpts, RenderResult, RichContentFrameProps, ValidateRichContentOpts };

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

function hastToText(node: HNode | HRoot): string {
  if (isTxt(node as HNode)) return (node as HText).value;
  const children = ("children" in node ? (node as HRoot | HElement).children : null) ?? [];
  return children.map((c) => hastToText(c as HNode)).join("");
}

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

function rehypeExternalLinks(): (tree: UnistNode) => void {
  return (tree) => {
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

interface TitleH1PluginOpts {
  readonly pageTitle: string;
}

/**
 * Removes a leading top-level H1 when its normalized visible text exactly
 * matches the page title, so a title already shown by the article shell is not
 * duplicated in the body. Runs before rehypeDowngradeH1; only the first
 * meaningful root child (ignoring leading blank text nodes) is considered, and
 * only when it is an H1 that matches. Every other H1 is left untouched for the
 * existing downgrade-to-H2 behavior.
 */
function rehypeRemoveTitleH1(opts: TitleH1PluginOpts): (tree: UnistNode) => void {
  const title = opts.pageTitle.replace(/\s+/g, " ").trim();
  return (tree) => {
    if (!title) return;
    const root = tree as unknown as HRoot;
    const children = root.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isBlankTxt(child)) continue;
      if (isElTag(child, "h1") && hastToText(child).replace(/\s+/g, " ").trim() === title) {
        children.splice(i, 1);
      }
      break;
    }
  };
}

function rehypeDowngradeH1(): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el) => {
      if (el.tagName === "h1") el.tagName = "h2";
    });
  };
}

function rehypeHeadingAnchors(): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el) => {
      if (el.tagName !== "h2" && el.tagName !== "h3") return;
      const id = typeof el.properties.id === "string" ? el.properties.id : "";
      if (!id) return;
      const text = hastToText(el).trim();
      const label = text ? `Permalink to ${text}` : "Permalink to this section";
      const anchor: HElement = {
        type: "element",
        tagName: "a",
        properties: {
          href: `#${id}`,
          className: ["vc-heading-anchor"],
          ariaLabel: label,
        },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["vc-heading-anchor-icon"], ariaHidden: "true" },
            children: [{ type: "text", value: "#" }],
          },
        ],
      };
      el.children = [anchor, ...el.children];
    });
  };
}

interface TocPluginOpts {
  readonly outline: OutlineEntry[];
  readonly warnings: string[];
}

function rehypeTocCollector(opts: TocPluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;

    walkEl(root.children, (el) => {
      if (el.tagName !== "h2" && el.tagName !== "h3") return;
      const depth = Number(el.tagName[1]);
      const text = hastToText(el).trim();
      const id = typeof el.properties.id === "string" ? el.properties.id : "";
      opts.outline.push({ depth, text, id });
    });

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

interface ImgPluginOpts {
  readonly warnings: string[];
}

function rehypeCaptionedImages(opts: ImgPluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;

    function hasEmptyAlt(img: HElement): boolean {
      const a = img.properties.alt;
      return !a || (typeof a === "string" && !a.trim());
    }

    function transform(children: HNode[]): void {
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
        const isImgOnly = sig.length === 1 && isEl(sig[0]) && isElTag(sig[0], "img");
        const isImgWithCaption =
          sig.length >= 2 &&
          isEl(sig[0]) &&
          isElTag(sig[0], "img") &&
          sig.slice(1).every((c) => isEl(c) && isElTag(c, "em"));

        if (isImgOnly) {
          const imgEl = sig[0] as HElement;
          if (hasEmptyAlt(imgEl)) opts.warnings.push("Image is missing alt text");
        } else if (isImgWithCaption) {
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
        } else {
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

function stripCalloutMarker(children: HNode[], marker: string): HNode[] | null {
  const result = [...children];
  const re = new RegExp(`^\\s*${escRe(marker)}[ \\t]*\\n?[ \\t]*`);

  for (let i = 0; i < result.length; i++) {
    const child = result[i];
    if (!isTxt(child)) break;
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
        transform(aside.children);
      }
    }

    transform(root.children);
  };
}

function rehypeCodeLang(): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el) => {
      if (el.tagName !== "pre") return;
      const code = el.children.find((c) => isEl(c) && isElTag(c, "code")) as HElement | undefined;
      if (!code) return;
      const classes = (code.properties.className as string[] | undefined) ?? [];
      const langClass = classes.find((c) => c.startsWith("language-"));
      if (langClass) el.properties.dataLang = langClass.slice("language-".length);
    });
  };
}

function rehypeCodeCopyFrames(): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el, i, siblings) => {
      if (el.tagName !== "pre" || el.properties.dataVcCodeFramed) return;
      const lang = typeof el.properties.dataLang === "string" ? el.properties.dataLang : "";
      el.properties.dataVcCodeFramed = true;

      const toolbarChildren: HNode[] = [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["vc-code-frame-lang"],
            ...(lang ? { dataVcCodeLang: lang } : {}),
          },
          children: [{ type: "text", value: lang || "text" }],
        },
        {
          type: "element",
          tagName: "button",
          properties: {
            type: "button",
            className: ["vc-code-copy"],
            dataVcCopy: "code",
          },
          children: [{ type: "text", value: "Copy" }],
        },
      ];

      siblings[i] = {
        type: "element",
        tagName: "div",
        properties: { className: ["vc-code-frame"], dataVcCodeFrame: true },
        children: [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["vc-code-frame-toolbar"] },
            children: toolbarChildren,
          },
          el,
        ],
      };
    });
  };
}

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), "aside", "figure", "figcaption", "nav", "button"],
  attributes: {
    ...defaultSchema.attributes,
    aside: [["className", "vc-callout"], "dataCallout"] as [string, string][],
    figure: ["dataCaptioned"],
    figcaption: [] as string[],
    nav: ["dataToc"],
    div: [
      ["className", "vc-code-frame", "vc-code-frame-toolbar"],
      ...(defaultSchema.attributes?.div ?? []),
      "dataVcCodeFrame",
    ] as ([string, ...string[]] | string)[],
    pre: [...(defaultSchema.attributes?.pre ?? []), "dataLang", "dataVcCodeFramed"],
    code: defaultSchema.attributes?.code ?? [],
    span: [
      [
        "className",
        "vc-callout-label",
        "vc-heading-anchor-icon",
        "vc-code-frame-lang",
      ],
      ...(defaultSchema.attributes?.span ?? []),
      "dataVcCodeLang",
      "ariaHidden",
    ] as ([string, ...string[]] | string)[],
    a: [
      ["className", "vc-heading-anchor"],
      ...(defaultSchema.attributes?.a ?? []),
      "rel",
      "ariaLabel",
    ] as ([string, ...string[]] | string)[],
    button: ["type", ["className", "vc-code-copy"], "dataVcCopy"] as ([string, string] | string)[],
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "decoding"],
    h2: [...(defaultSchema.attributes?.h2 ?? []), "id"],
    h3: [...(defaultSchema.attributes?.h3 ?? []), "id"],
  },
};

export function renderRichContent(markdown: string, opts?: RenderOpts): RenderResult {
  const outline: OutlineEntry[] = [];
  const warnings: string[] = [];

  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false });

  if (opts?.pageTitle) {
    pipeline.use(rehypeRemoveTitleH1, { pageTitle: opts.pageTitle });
  }

  const file = pipeline
    .use(rehypeDowngradeH1)
    .use(rehypeSlug, { prefix: "h-" })
    .use(rehypeTocCollector, { outline, warnings })
    .use(rehypeHeadingAnchors)
    .use(rehypeExternalLinks)
    .use(rehypeCaptionedImages, { warnings })
    .use(rehypeCallouts, { warnings })
    .use(rehypeCodeLang)
    .use(rehypeCodeCopyFrames)
    .use(rehypeSanitize, sanitizeSchema as Parameters<typeof rehypeSanitize>[0])
    .use(rehypeReact, { Fragment, jsx, jsxs })
    .processSync(markdown);

  const node = file.result as unknown as ReactNode;
  return { node, outline, warnings };
}

export function RichContentFrame({
  node,
  presetId,
  mode,
  className,
}: RichContentFrameProps) {
  return (
    <div
      className={className}
      data-rich-content=""
      data-vc-theme={presetId ?? "minimal"}
      {...(mode === "light" || mode === "dark" ? { "data-vc-mode": mode } : {})}
    >
      {node}
    </div>
  );
}

export function renderRichContentResultToHtml(result: RenderResult, opts?: RenderOpts): string {
  return renderToStaticMarkup(
    <RichContentFrame node={result.node} presetId={opts?.presetId} className={opts?.className} />,
  );
}

export function renderRichContentToHtml(markdown: string, opts?: RenderOpts): string {
  return renderRichContentResultToHtml(renderRichContent(markdown, opts), opts);
}

export function validateRichContent(
  markdown: string,
  opts?: ValidateRichContentOpts,
): string[] {
  const warnings =
    opts?.renderWarnings !== undefined
      ? [...opts.renderWarnings]
      : renderRichContent(markdown).warnings;

  if (!opts?.hasPageToc) {
    const wordCount = markdown.split(/\s+/).filter(Boolean).length;
    if (wordCount > 600 && !markdown.includes("[[toc]]")) {
      warnings.push(
        "Post has more than 600 words but no [[toc]] marker - consider adding a table of contents",
      );
    }
  }

  if (/^```[ \t]*\r?\n/m.test(markdown)) {
    warnings.push("One or more code fences are missing a language identifier (e.g. ` ```js `)");
  }

  return warnings;
}

export function parseMarkdown(source: string): ReactNode[] {
  return [renderRichContent(source).node];
}

export function safeHref(raw: string): string {
  const href = raw.trim();
  if (href.startsWith("//")) return "#";
  if (href.startsWith("/") || href.startsWith("#")) return href;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return "#";
}