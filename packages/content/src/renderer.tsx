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
import rehypeRaw from "rehype-raw";
import remarkDirective from "remark-directive";
import remarkSmartypants from "remark-smartypants";
import type {
  CodeHighlighter,
  OutlineEntry,
  RenderOpts,
  RenderResult,
  RenderedImageAttributes,
  RichContentFrameProps,
  ValidateRichContentOpts,
} from "./types.js";

export const RENDERER_VERSION = "3";

export type {
  OutlineEntry,
  RenderedImageAttributes,
  RenderOpts,
  RenderResult,
  RichContentFrameProps,
  ValidateRichContentOpts,
};

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
/** Compares titles across smart punctuation, which remark-smartypants applies to the body. */
function normalizeTitle(value: string): string {
  // Canonicalize both sides: smartypants turns `--` into an em dash and
  // ``x'' into curly quotes, while the stored title keeps whatever was typed.
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]|``|''/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u2013\u2014]|-{2,3}/g, "\u2014")
    .replace(/\s+/g, " ")
    .trim();
}

function rehypeRemoveTitleH1(opts: TitleH1PluginOpts): (tree: UnistNode) => void {
  const title = normalizeTitle(opts.pageTitle);
  return (tree) => {
    if (!title) return;
    const root = tree as unknown as HRoot;
    const children = root.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isBlankTxt(child)) continue;
      if (isElTag(child, "h1") && normalizeTitle(hastToText(child)) === title) {
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
      if (el.tagName !== "h2" && el.tagName !== "h3" && el.tagName !== "h4") return;
      if (isFootnoteHeading(el)) return;
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

function isFootnoteHeading(el: HElement): boolean {
  return el.properties.id === "footnote-label";
}

function tocLink(h: OutlineEntry): HElement {
  return {
    type: "element",
    tagName: "a",
    properties: { href: `#${h.id}` },
    children: [{ type: "text", value: h.text }],
  };
}

/** Inline [[toc]]: h2 entries with their h3s nested beneath. */
function buildTocList(outline: OutlineEntry[]): HElement {
  const items: HElement[] = [];
  let current: HElement | null = null;
  for (const h of outline) {
    if (h.depth === 3 && current) {
      let sub = current.children.find((c) => isElTag(c, "ul")) as HElement | undefined;
      if (!sub) {
        sub = { type: "element", tagName: "ul", properties: {}, children: [] };
        current.children.push(sub);
      }
      sub.children.push({ type: "element", tagName: "li", properties: {}, children: [tocLink(h)] });
      continue;
    }
    current = { type: "element", tagName: "li", properties: {}, children: [tocLink(h)] };
    items.push(current);
  }
  return { type: "element", tagName: "ul", properties: {}, children: items };
}

function rehypeTocCollector(opts: TocPluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;

    walkEl(root.children, (el) => {
      if (el.tagName !== "h2" && el.tagName !== "h3") return;
      if (isFootnoteHeading(el)) return;
      const depth = Number(el.tagName[1]);
      const text = hastToText(el).trim();
      const id = typeof el.properties.id === "string" ? el.properties.id : "";
      if (!id) return;
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
            children[i] = {
              type: "element",
              tagName: "nav",
              properties: { dataToc: true },
              children: [buildTocList(opts.outline)],
            };
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
          if (hasEmptyAlt(imgEl)) opts.warnings.push(MISSING_IMAGE_ALT_WARNING);
        } else if (isImgWithCaption) {
          const imgEl = sig[0] as HElement;
          const captionEms = sig.slice(1) as HElement[];
          if (hasEmptyAlt(imgEl)) opts.warnings.push(MISSING_IMAGE_ALT_WARNING);

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
              opts.warnings.push(MISSING_IMAGE_ALT_WARNING);
            }
          }
        }

        i++;
      }
    }

    transform(root.children);
  };
}
interface ResponsiveImagePluginOpts {
  readonly resolveImage: (src: string) => RenderedImageAttributes | null;
}

function rehypeResponsiveImages(opts: ResponsiveImagePluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el) => {
      if (el.tagName !== "img") return;
      const src = el.properties.src;
      if (typeof src !== "string") return;
      const resolved = opts.resolveImage(src);
      if (!resolved) return;
      if (resolved.src) el.properties.src = resolved.src;
      if (resolved.srcSet) el.properties.srcSet = resolved.srcSet;
      if (resolved.sizes) el.properties.sizes = resolved.sizes;
      el.properties.loading = "lazy";
      el.properties.decoding = "async";
    });
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

// ─── Directives: `:::note[Title]` callouts and `:::details[Summary]` ──────

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  name?: string;
  lang?: string | null;
  meta?: string | null;
  data?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const DIRECTIVE_CALLOUTS: Record<string, CalloutKind> = {
  note: "NOTE",
  info: "NOTE",
  tip: "TIP",
  success: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
  caution: "CAUTION",
  danger: "CAUTION",
  error: "CAUTION",
};

function labelNode(children: MdNode[], hName: string, className?: string): MdNode {
  return {
    type: "paragraph",
    data: { hName, hProperties: className ? { className: [className] } : {} },
    children,
  };
}

function remarkVcDirectives(opts: { warnings: string[] }) {
  return (tree: MdNode, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : "";

    function literal(node: MdNode): string {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (source && start != null && end != null) return source.slice(start, end);
      return `:${node.name ?? ""}`;
    }

    function visit(parent: MdNode): void {
      const children = parent.children;
      if (!children) return;
      for (let i = 0; i < children.length; i++) {
        const node = children[i]!;
        if (node.type === "textDirective") {
          // `:name` in prose (times, ratios, "note:this") is text, not syntax.
          children[i] = { type: "text", value: literal(node) };
          continue;
        }
        if (node.type === "leafDirective") {
          children[i] = { type: "paragraph", children: [{ type: "text", value: literal(node) }] };
          continue;
        }
        if (node.type === "containerDirective") {
          const name = (node.name ?? "").toLowerCase();
          const body = node.children ?? [];
          const labelIdx = body.findIndex((c) => c.type === "paragraph" && c.data?.directiveLabel);
          const label = labelIdx === -1 ? null : body[labelIdx]!;
          const rest = body.filter((_, idx) => idx !== labelIdx);
          const kind = Object.hasOwn(DIRECTIVE_CALLOUTS, name) ? DIRECTIVE_CALLOUTS[name] : undefined;
          if (kind) {
            const title = label?.children?.length ? label.children : [{ type: "text", value: CALLOUT_LABEL[kind] }];
            node.data = {
              hName: "aside",
              hProperties: { className: ["vc-callout"], dataCallout: kind.toLowerCase() },
            };
            node.children = [labelNode(title, "span", "vc-callout-label"), ...rest];
          } else if (name === "details") {
            const summary = label?.children?.length ? label.children : [{ type: "text", value: "Details" }];
            node.data = { hName: "details", hProperties: { className: ["vc-details"] } };
            node.children = [labelNode(summary, "summary"), ...rest];
          } else {
            opts.warnings.push(`Unknown block ":::${node.name ?? ""}" - rendered its content without a wrapper`);
            children.splice(i, 1, ...rest);
            i--;
            continue;
          }
        }
        visit(node);
      }
    }

    visit(tree);
  };
}

// ─── Raw HTML: GitHub's allowlist survives, everything else warns ─────────

const RAW_HTML_ALLOWED = new Set((defaultSchema.tagNames ?? []).map((t) => t.toLowerCase()));

function remarkRawHtmlWarnings(opts: { warnings: string[] }) {
  return (tree: MdNode) => {
    const dropped = new Set<string>();
    (function visit(node: MdNode) {
      if (node.type === "html" && typeof node.value === "string") {
        for (const m of node.value.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) {
          const tag = m[1]!.toLowerCase();
          if (!RAW_HTML_ALLOWED.has(tag)) dropped.add(tag);
        }
      }
      node.children?.forEach(visit);
    })(tree);
    for (const tag of dropped) {
      opts.warnings.push(`HTML <${tag}> is not allowed in posts and was removed`);
    }
  };
}

/** Carries fence meta (` ```ts title="app.ts" {2-3} `) onto the HAST <code>. */
function remarkCodeMeta() {
  return (tree: MdNode) => {
    (function visit(node: MdNode) {
      if (node.type === "code" && node.meta) {
        const data = (node.data ??= {});
        data.hProperties = { ...(data.hProperties as object | undefined), dataMeta: node.meta };
      }
      node.children?.forEach(visit);
    })(tree);
  };
}

/**
 * Raw HTML may not mint ids/names (DOM clobbering, hijacked footnote anchors).
 * Ids that exist before rehype-raw (remark-rehype's footnotes) get a per-render
 * marker that raw HTML cannot guess; after rehype-raw only marked ids survive.
 */
function rehypeMarkGeneratedIds(opts: { marker: string }): (tree: UnistNode) => void {
  return (tree) => {
    walkEl((tree as unknown as HRoot).children, (el) => {
      if (el.properties.id != null) el.properties.dataVcGeneratedId = opts.marker;
    });
  };
}

function rehypeStripRawIds(opts: { marker: string }): (tree: UnistNode) => void {
  return (tree) => {
    walkEl((tree as unknown as HRoot).children, (el) => {
      const generated = el.properties.dataVcGeneratedId === opts.marker;
      delete el.properties.dataVcGeneratedId;
      if (!generated) delete el.properties.id;
      delete el.properties.name;
    });
  };
}

/**
 * Autolinked URLs must display exactly as written; smartypants would turn
 * `--` into a dash (and break the YouTube-card match). Save before, restore after.
 */
function isAutolinkText(url: string, text: string): boolean {
  return url === text || url === `http://${text}` || url === `https://${text}` || url === `mailto:${text}`;
}

function remarkSaveAutolinkText(opts: { saved: Map<MdNode, string> }) {
  return (tree: MdNode) => {
    (function visit(node: MdNode) {
      if (node.type === "link" && node.children?.length === 1) {
        const child = node.children[0]!;
        const url = (node as MdNode & { url?: string }).url ?? "";
        if (child.type === "text" && typeof child.value === "string" && isAutolinkText(url, child.value)) {
          opts.saved.set(child, child.value);
        }
      }
      node.children?.forEach(visit);
    })(tree);
  };
}

/**
 * remark-smartypants runs retext over one string built from the whole tree,
 * which is superlinear: a 500 KB paragraph costs seconds of CPU. Run it per
 * top-level block instead (same output: it already pads block boundaries),
 * descend into oversized containers, and leave an oversized leaf block as typed.
 */
const SMARTYPANTS_MAX_BLOCK = 20_000;

function mdToText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(mdToText).join("");
}

function mdLength(node: MdNode): number {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start != null && end != null ? end - start : mdToText(node).length;
}

function remarkSmartypantsBounded() {
  const transform = (remarkSmartypants as unknown as () => (tree: MdNode) => void)();
  const smarten = (node: MdNode): void => {
    if (mdLength(node) <= SMARTYPANTS_MAX_BLOCK) {
      transform({ type: "root", children: [node] });
      return;
    }
    if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") return;
    node.children?.forEach(smarten);
  };
  return (tree: MdNode) => {
    tree.children?.forEach(smarten);
  };
}

function remarkRestoreAutolinkText(opts: { saved: Map<MdNode, string> }) {
  return () => {
    for (const [node, value] of opts.saved) node.value = value;
  };
}

// ─── Code blocks (runs after sanitize; output is generated, not user HTML) ─

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  shell: "shellscript",
  console: "shellscript",
  "shell-session": "shellscript",
  yml: "yaml",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  dockerfile: "docker",
  gql: "graphql",
  kt: "kotlin",
  svg: "xml",
  conf: "ini",
  env: "ini",
};

interface CodeMeta {
  title?: string;
  highlight: Set<number>;
  lineNumbers: boolean;
}

/** Highlighted lines past this are ignored (and bound the work a meta string can cause). */
const MAX_HIGHLIGHT_LINE = 5000;

function parseRanges(spec: string, into: Set<number>, budget: { left: number }): void {
  for (const part of spec.split(",")) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = Math.min(m[2] ? Number(m[2]) : from, MAX_HIGHLIGHT_LINE);
    for (let n = from; n <= to; n++) {
      if (budget.left-- <= 0) return;
      into.add(n);
    }
  }
}

export function parseCodeMeta(meta: string): CodeMeta {
  const out: CodeMeta = { highlight: new Set(), lineNumbers: false };
  let rest = meta;
  rest = rest.replace(/(?:title|filename|file)=(?:"([^"]*)"|'([^']*)'|(\S+))/i, (_, a, b, c) => {
    out.title = (a ?? b ?? c ?? "").trim() || undefined;
    return " ";
  });
  const budget = { left: MAX_HIGHLIGHT_LINE };
  rest = rest.replace(/\{([\d,\s-]+)\}/g, (_, spec: string) => {
    parseRanges(spec, out.highlight, budget);
    return " ";
  });
  rest = rest.replace(/\b(?:showLineNumbers|lineNumbers|line-numbers|ln)\b/g, () => {
    out.lineNumbers = true;
    return " ";
  });
  const bare = rest.trim().split(/\s+/)[0];
  if (!out.title && bare && /^[\w@~./-]+\.[\w-]+$|\//.test(bare) && !bare.includes("=")) {
    out.title = bare;
  }
  return out;
}

type LineMark = "add" | "remove" | "highlight" | "focus";

const NOTATION_KIND_RE = /^\[!code[ \t]+(\+\+|--|highlight|hl|focus)(?::\d+)?\][ \t]*(?:\*\/\}|-->|\*\/)?$/;
const NOTATION_COMMENTS = ["{/*", "<!--", "/*", "//", "--", "#", ";"];

function trimEndBlank(s: string): string {
  let end = s.length;
  while (end > 0 && (s[end - 1] === " " || s[end - 1] === "\t")) end--;
  return s.slice(0, end);
}

/**
 * Parses a trailing `// [!code ++]` style marker. Hand-rolled (no unanchored
 * regex over the whole line) so adversarial whitespace stays linear.
 */
function parseNotation(line: string): { kind: string; cut: number } | null {
  const at = line.lastIndexOf("[!code");
  if (at === -1) return null;
  const m = NOTATION_KIND_RE.exec(trimEndBlank(line.slice(at)));
  if (!m) return null;
  const head = trimEndBlank(line.slice(0, at));
  const comment = NOTATION_COMMENTS.find((c) => head.endsWith(c));
  if (!comment) return null;
  return { kind: m[1]!, cut: trimEndBlank(head.slice(0, head.length - comment.length)).length };
}

export function applyCodeNotation(code: string): { code: string; marks: Map<number, LineMark> } {
  const marks = new Map<number, LineMark>();
  const lines = code.split("\n").map((line, i) => {
    const m = parseNotation(line);
    if (!m) return line;
    const kind = m.kind;
    marks.set(i + 1, kind === "++" ? "add" : kind === "--" ? "remove" : kind === "focus" ? "focus" : "highlight");
    return line.slice(0, m.cut);
  });
  return { code: lines.join("\n"), marks };
}

function textEl(tagName: string, className: string[], value: string, extra: Record<string, unknown> = {}): HElement {
  return { type: "element", tagName, properties: { className, ...extra }, children: [{ type: "text", value }] };
}

/**
 * Characters of code Shiki may tokenize per render. TextMate grammars on the
 * JS regex engine can take ~100µs/char on adversarial input, so blocks past
 * the budget render framed but uncolored instead of pinning the Worker's CPU.
 */
export const HIGHLIGHT_CHAR_BUDGET = 12_000;

function rehypeCodeBlocks(opts: { highlighter?: CodeHighlighter | null; target: "web" | "feed" }) {
  return (tree: UnistNode) => {
    let highlightBudget = HIGHLIGHT_CHAR_BUDGET;
    walkEl((tree as unknown as HRoot).children, (pre, i, siblings) => {
      if (pre.tagName !== "pre") return;
      const code = pre.children.find((c) => isElTag(c, "code")) as HElement | undefined;
      if (!code) return;
      const classes = (code.properties.className as string[] | undefined) ?? [];
      const rawLang = classes.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
      const lang = rawLang.toLowerCase();
      const meta = parseCodeMeta(typeof code.properties.dataMeta === "string" ? code.properties.dataMeta : "");
      const source = hastToText(code).replace(/\n$/, "");
      const { code: cleaned, marks } = applyCodeNotation(source);

      if (opts.target === "feed") {
        pre.properties = {};
        pre.children = [
          {
            type: "element",
            tagName: "code",
            properties: rawLang ? { className: [`language-${rawLang}`] } : {},
            children: [{ type: "text", value: cleaned }],
          },
        ];
        return;
      }

      const grammar = Object.hasOwn(LANG_ALIASES, lang) ? LANG_ALIASES[lang]! : lang;
      const canHighlight =
        grammar && grammar !== "text" && cleaned.length <= highlightBudget && opts.highlighter?.supports(grammar);
      if (canHighlight) highlightBudget -= cleaned.length;
      const highlighted = canHighlight ? opts.highlighter!.highlight(cleaned, grammar) : null;
      const rawLines = cleaned.split("\n");
      const lineEls: HElement[] = highlighted
        ? (highlighted.lines.filter((n) => n.type === "element") as unknown as HElement[])
        : rawLines.map((l) => textEl("span", ["line"], l));

      lineEls.forEach((line, idx) => {
        const n = idx + 1;
        const props: Record<string, unknown> = { className: ["line"] };
        const text = rawLines[idx] ?? "";
        let mark = marks.get(n);
        if (!mark && lang === "diff") {
          if (text.startsWith("+") && !text.startsWith("+++")) mark = "add";
          else if (text.startsWith("-") && !text.startsWith("---")) mark = "remove";
        }
        if (mark === "add" || mark === "remove") props.dataDiff = mark;
        if (mark === "highlight" || meta.highlight.has(n)) props.dataHighlighted = true;
        if (mark === "focus") props.dataFocus = true;
        line.properties = { ...line.properties, ...props, className: ["line"] };
      });

      const codeChildren: HNode[] = [];
      lineEls.forEach((line, idx) => {
        if (idx > 0) codeChildren.push({ type: "text", value: "\n" } as HText);
        codeChildren.push(line);
      });

      const hasFocus = lineEls.some((l) => l.properties.dataFocus);
      const newPre: HElement = {
        type: "element",
        tagName: "pre",
        properties: {
          className: highlighted ? ["vc-shiki"] : [],
          ...(lang ? { dataLang: rawLang } : {}),
          dataVcCodeFramed: true,
          tabIndex: 0,
          ...(meta.lineNumbers ? { dataLineNumbers: true } : {}),
          ...(hasFocus ? { dataHasFocus: true } : {}),
        },
        children: [
          {
            type: "element",
            tagName: "code",
            properties: rawLang ? { className: [`language-${rawLang}`] } : {},
            children: codeChildren,
          },
        ],
      };

      const head: HNode[] = [
        meta.title
          ? textEl("span", ["vc-code-frame-title"], meta.title)
          : textEl("span", ["vc-code-frame-lang"], rawLang || "text", rawLang ? { dataVcCodeLang: rawLang } : {}),
      ];
      if (meta.title && rawLang) head.push(textEl("span", ["vc-code-frame-lang"], rawLang, { dataVcCodeLang: rawLang }));
      head.push(
        textEl("button", ["vc-code-copy"], "Copy", {
          type: "button",
          dataVcCopy: "code",
          ariaLabel: meta.title ? `Copy ${meta.title}` : "Copy code",
        }),
      );

      siblings[i] = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["vc-code-frame"],
          dataVcCodeFrame: true,
          ...(meta.title ? { dataHasTitle: true } : {}),
        },
        children: [
          { type: "element", tagName: "div", properties: { className: ["vc-code-frame-toolbar"] }, children: head },
          newPre,
        ],
      };
    });
  };
}

// ─── Media polish (post-sanitize) ─────────────────────────────────────────

function youtubeId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** A bare YouTube link on its own line becomes a lightweight click-through card. */
function rehypeEmbeds(): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;
    (function visit(children: HNode[]) {
      for (let i = 0; i < children.length; i++) {
        const n = children[i]!;
        if (!isEl(n)) continue;
        if (n.tagName === "p") {
          const sig = n.children.filter((c) => !isBlankTxt(c));
          const only = sig.length === 1 && isElTag(sig[0]!, "a") ? (sig[0] as HElement) : null;
          const href = only && typeof only.properties.href === "string" ? only.properties.href : "";
          const id = only && hastToText(only).trim() === href ? youtubeId(href) : null;
          if (id) {
            children[i] = {
              type: "element",
              tagName: "figure",
              properties: { className: ["vc-embed"], dataEmbed: "youtube" },
              children: [
                {
                  type: "element",
                  tagName: "a",
                  properties: {
                    className: ["vc-embed-link"],
                    href: `https://www.youtube.com/watch?v=${id}`,
                    rel: ["noopener", "noreferrer"],
                    ariaLabel: "Watch on YouTube",
                  },
                  children: [
                    {
                      type: "element",
                      tagName: "img",
                      properties: {
                        src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
                        alt: "",
                        width: 480,
                        height: 360,
                        loading: "lazy",
                        decoding: "async",
                      },
                      children: [],
                    },
                    { type: "element", tagName: "span", properties: { className: ["vc-embed-play"], ariaHidden: "true" }, children: [] },
                  ],
                },
              ],
            } as HElement;
            continue;
          }
        }
        visit(n.children);
      }
    })(root.children);
  };
}

function rehypeImagePolish(opts: { zoom: boolean }): (tree: UnistNode) => void {
  return (tree) => {
    (function visit(children: HNode[], inLink: boolean) {
      for (const n of children) {
        if (!isEl(n)) continue;
        if (n.tagName === "img") {
          n.properties.loading ??= "lazy";
          n.properties.decoding ??= "async";
          if (opts.zoom && !inLink) n.properties.dataZoomable = true;
        }
        visit(n.children, inLink || n.tagName === "a");
      }
    })((tree as unknown as HRoot).children, false);
  };
}

function absolutize(value: string, base: string): string {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function rehypeAbsoluteUrls(opts: { baseUrl: string }): (tree: UnistNode) => void {
  return (tree) => {
    walkEl((tree as unknown as HRoot).children, (el) => {
      const p = el.properties;
      if (typeof p.href === "string") p.href = absolutize(p.href, opts.baseUrl);
      if (typeof p.src === "string") p.src = absolutize(p.src, opts.baseUrl);
      if (typeof p.srcSet === "string") {
        p.srcSet = p.srcSet
          .split(",")
          .map((part) => {
            const [url, ...desc] = part.trim().split(/\s+/);
            return [absolutize(url ?? "", opts.baseUrl), ...desc].join(" ");
          })
          .join(", ");
      }
    });
  };
}

// ─── Sanitize schema (GitHub's allowlist + vibecms structure) ─────────────

type AttrDef = string | [string, ...(string | RegExp | boolean | number)[]];
const baseAttrs = (tag: string): AttrDef[] => (defaultSchema.attributes?.[tag] ?? []) as AttrDef[];
const withoutClassName = (defs: AttrDef[]) => defs.filter((d) => !(Array.isArray(d) && d[0] === "className"));

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), "aside", "figure", "figcaption", "nav"],
  attributes: {
    ...defaultSchema.attributes,
    aside: [["className", "vc-callout"], "dataCallout"],
    details: [...baseAttrs("details"), ["className", "vc-details"]],
    figure: ["dataCaptioned"],
    figcaption: [],
    nav: ["dataToc"],
    code: [...baseAttrs("code"), "dataMeta"],
    span: [
      ...withoutClassName(baseAttrs("span")),
      ["className", "vc-callout-label", "vc-heading-anchor-icon"],
      "ariaHidden",
    ],
    a: [
      ...withoutClassName(baseAttrs("a")),
      ["className", "vc-heading-anchor", "data-footnote-backref"],
      "rel",
      "ariaLabel",
    ],
    img: [...baseAttrs("img"), "loading", "decoding", "srcSet", "sizes"],
    h2: [...baseAttrs("h2"), "id"],
    h3: [...baseAttrs("h3"), "id"],
    h4: [...baseAttrs("h4"), "id"],
  },
};

export function renderRichContent(markdown: string, opts?: RenderOpts): RenderResult {
  const outline: OutlineEntry[] = [];
  const warnings: string[] = [];
  const target = opts?.target ?? "web";
  const autolinkText = new Map<MdNode, string>();
  // Unguessable per render, so raw HTML can never forge a "generated" id.
  const idMarker = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkVcDirectives, { warnings })
    .use(remarkSaveAutolinkText, { saved: autolinkText })
    .use(remarkSmartypantsBounded)
    .use(remarkRestoreAutolinkText, { saved: autolinkText })
    .use(remarkRawHtmlWarnings, { warnings })
    .use(remarkCodeMeta)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeMarkGeneratedIds, { marker: idMarker })
    .use(rehypeRaw)
    .use(rehypeStripRawIds, { marker: idMarker });

  if (opts?.pageTitle) {
    pipeline.use(rehypeRemoveTitleH1, { pageTitle: opts.pageTitle });
  }

  if (opts?.resolveImage) {
    pipeline.use(rehypeResponsiveImages, { resolveImage: opts.resolveImage });
  }

  pipeline
    .use(rehypeDowngradeH1)
    .use(rehypeSlug, { prefix: "h-" })
    .use(rehypeTocCollector, { outline, warnings });
  if (target === "web") pipeline.use(rehypeHeadingAnchors);
  pipeline
    .use(rehypeExternalLinks)
    .use(rehypeCaptionedImages, { warnings })
    .use(rehypeCallouts, { warnings })
    .use(rehypeSanitize, sanitizeSchema as Parameters<typeof rehypeSanitize>[0])
    .use(rehypeCodeBlocks, { highlighter: opts?.highlighter, target })
    .use(rehypeImagePolish, { zoom: target === "web" });
  if (target === "web") pipeline.use(rehypeEmbeds);
  if (target === "feed" && opts?.baseUrl) pipeline.use(rehypeAbsoluteUrls, { baseUrl: opts.baseUrl });

  const file = pipeline.use(rehypeReact, { Fragment, jsx, jsxs }).processSync(markdown);

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

export const MISSING_IMAGE_ALT_WARNING = "Image is missing alt text";

function hasUnlabeledCodeFence(markdown: string) {
  let openFence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;

    const fence = match[1]!;
    const marker = fence[0] as "`" | "~";
    const suffix = match[2]!;
    if (openFence) {
      if (marker === openFence.marker && fence.length >= openFence.length && suffix.trim() === "") {
        openFence = null;
      }
      continue;
    }

    if (suffix.trim() === "") return true;
    openFence = { marker, length: fence.length };
  }

  return false;
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

  if (hasUnlabeledCodeFence(markdown)) {
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
