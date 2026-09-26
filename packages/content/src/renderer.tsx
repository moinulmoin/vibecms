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
import remarkMath from "remark-math";
import type {
  CodeHighlighter,
  MathRenderer,
  OutlineEntry,
  RenderOpts,
  RenderResult,
  RenderedImageAttributes,
  RichContentFrameProps,
  ValidateRichContentOpts,
} from "./types.js";

import {
  MISSING_IMAGE_ALT_WARNING,
  RENDERER_VERSION,
  RENDER_WARNING,
  renderWarningCode,
  type RenderWarningCode,
} from "./constants.js";

export { MISSING_IMAGE_ALT_WARNING, RENDERER_VERSION, RENDER_WARNING, renderWarningCode };
export type { RenderWarningCode };

/** Records one warning: human sentence + stable code, index-aligned. */
type Warn = (code: RenderWarningCode, message: string) => void;

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

/**
 * `arr.splice(at, 1, ...items)` without spreading `items` into call
 * arguments: a directive/block can hold 100k+ children, which overflows the
 * stack as spread arguments.
 */
function replaceAt<T>(arr: T[], at: number, items: readonly T[]): void {
  const tail = arr.splice(at + 1);
  arr.length = at;
  for (const item of items) arr.push(item);
  for (const item of tail) arr.push(item);
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

const ANCHORED_HEADINGS = new Set(["h2", "h3", "h4", "h5", "h6"]);

function rehypeHeadingAnchors(): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;
    walkEl(root.children, (el) => {
      if (!ANCHORED_HEADINGS.has(el.tagName)) return;
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
  readonly warn: Warn;
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
      if (!/^h[1-6]$/.test(el.tagName)) return;
      const hidden = el.properties.dataVcToc === "hide";
      delete el.properties.dataVcToc;
      if (hidden) return;
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
            opts.warn(
              RENDER_WARNING.TOC_NO_HEADINGS,
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
  readonly warn: Warn;
}

function rehypeCaptionedImages(): (tree: UnistNode) => void {
  return (tree) => {
    const root = tree as unknown as HRoot;

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
          // `![alt](src "Caption")`: the title becomes a visible caption.
          const title = typeof imgEl.properties.title === "string" ? imgEl.properties.title.trim() : "";
          if (title) {
            delete imgEl.properties.title;
            children[i] = {
              type: "element",
              tagName: "figure",
              properties: { dataCaptioned: true },
              children: [
                imgEl,
                { type: "element", tagName: "figcaption", properties: {}, children: [{ type: "text", value: title }] },
              ],
            } as HElement;
          }
        } else if (isImgWithCaption) {
          const imgEl = sig[0] as HElement;
          const captionEms = sig.slice(1) as HElement[];

          children[i] = {
            type: "element",
            tagName: "figure",
            properties: { dataCaptioned: true },
            children: [
              imgEl,
              { type: "element", tagName: "figcaption", properties: {}, children: captionEms },
            ],
          } as HElement;
        }

        i++;
      }
    }

    transform(root.children);
  };
}

function rehypeValidateImageAlt(opts: ImgPluginOpts): (tree: UnistNode) => void {
  return (tree) => {
    walkEl((tree as unknown as HRoot).children, (el) => {
      if (el.tagName !== "img") return;
      const alt = el.properties.alt;
      if (typeof alt !== "string" || !alt.trim()) {
        opts.warn(RENDER_WARNING.IMAGE_MISSING_ALT, MISSING_IMAGE_ALT_WARNING);
      }
    });
  };
}
const GH_MODE_FRAGMENT = /#gh-(dark|light)-mode-only$/;

function isDimension(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 20_000;
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
      // `#gh-dark-mode-only` style fragments are presentation hints, not part of the asset URL.
      const mode = GH_MODE_FRAGMENT.exec(src);
      const resolved = opts.resolveImage(mode ? src.slice(0, mode.index) : src);
      if (!resolved) return;
      if (resolved.src) el.properties.src = mode ? resolved.src + mode[0] : resolved.src;
      if (resolved.srcSet) el.properties.srcSet = resolved.srcSet;
      if (resolved.sizes) el.properties.sizes = resolved.sizes;
      if (isDimension(resolved.width)) el.properties.width = resolved.width;
      if (isDimension(resolved.height)) el.properties.height = resolved.height;
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
  readonly warn: Warn;
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
          opts.warn(
            RENDER_WARNING.CALLOUT_UNKNOWN,
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

/** Placeholder the post-sanitize `rehypeBlocks` pass turns into a generated component. */
function blockNode(kind: string, children: MdNode[], label?: string): MdNode {
  return {
    type: "containerDirective",
    data: { hName: "div", hProperties: { dataVcBlock: kind, ...(label != null ? { dataVcLabel: label } : {}) } },
    children,
  };
}

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const INSTALL_FLAGS: Record<string, Record<PackageManager, string>> = {
  "-D": { npm: "-D", pnpm: "-D", yarn: "-D", bun: "-d" },
  "--save-dev": { npm: "-D", pnpm: "-D", yarn: "-D", bun: "-d" },
  "-E": { npm: "-E", pnpm: "-E", yarn: "-E", bun: "--exact" },
  "--save-exact": { npm: "-E", pnpm: "-E", yarn: "-E", bun: "--exact" },
  "-O": { npm: "-O", pnpm: "-O", yarn: "-O", bun: "--optional" },
  "--save-optional": { npm: "-O", pnpm: "-O", yarn: "-O", bun: "--optional" },
};

/** One `npm i -D x` / `npx y` / bare `x y` line, spelled for another package manager. */
export function installCommand(line: string, pm: PackageManager): string {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens[0] === "npx") {
    const rest = tokens.slice(1).filter((t) => t !== "-y" && t !== "--yes").join(" ");
    return { npm: `npx ${rest}`, pnpm: `pnpm dlx ${rest}`, yarn: `yarn dlx ${rest}`, bun: `bunx ${rest}` }[pm];
  }
  let args = tokens;
  if (tokens[0] === "npm") {
    const sub = tokens[1] ?? "";
    if (!["i", "install", "add"].includes(sub)) {
      // `npm create x`, `npm run build`, ... read the same in every manager.
      return [pm, ...tokens.slice(1)].join(" ");
    }
    args = tokens.slice(2);
  }
  if (args.length === 0) return pm === "yarn" ? "yarn" : `${pm} install`;
  const global = args.some((a) => a === "-g" || a === "--global");
  const mapped = args
    .filter((a) => a !== "-g" && a !== "--global")
    .map((a) => (Object.hasOwn(INSTALL_FLAGS, a) ? INSTALL_FLAGS[a]![pm] : a));
  if (pm === "npm") return ["npm", "install", ...(global ? ["-g"] : []), ...mapped].join(" ");
  if (pm === "yarn" && global) return ["yarn", "global", "add", ...mapped].join(" ");
  return [pm, "add", ...(global ? ["-g"] : []), ...mapped].join(" ");
}

/** Fence meta minus its title (`title=`, `[label]`, bare filename); the tab carries it instead. */
function codeGroupLabel(node: MdNode): { label: string; meta: string } {
  let meta = node.meta ?? "";
  let label = "";
  meta = meta.replace(/\[([^\]\n]{1,80})\]/, (_, l: string) => {
    label = l.trim();
    return " ";
  });
  const title = parseCodeMeta(meta).title;
  if (title) {
    label ||= title;
    meta = meta.replace(/(?:title|filename|file)=(?:"[^"]*"|'[^']*'|\S+)/i, " ");
    const bare = parseCodeMeta(meta).title;
    if (bare) meta = meta.replace(bare, " ");
  }
  return { label: label || node.lang || "Code", meta: meta.trim() };
}

function remarkVcDirectives(opts: { warn: Warn }) {
  return (tree: MdNode, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : "";

    function literal(node: MdNode): string {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (source && start != null && end != null) return source.slice(start, end);
      return `:${node.name ?? ""}`;
    }

    function splitLabel(node: MdNode): { label: MdNode | null; rest: MdNode[] } {
      const body = node.children ?? [];
      const labelIdx = body.findIndex((c) => c.type === "paragraph" && c.data?.directiveLabel);
      return {
        label: labelIdx === -1 ? null : body[labelIdx]!,
        rest: body.filter((_, idx) => idx !== labelIdx),
      };
    }

    /** `::::tabs` of `:::tab[Label]` blocks; anything else is hoisted above with a warning. */
    function tabs(node: MdNode): MdNode[] {
      const { rest } = splitLabel(node);
      const panels: MdNode[] = [];
      const stray: MdNode[] = [];
      for (const child of rest) {
        if (child.type === "containerDirective" && (child.name ?? "").toLowerCase() === "tab") {
          const { label, rest: body } = splitLabel(child);
          const text = label ? mdToText(label).trim() : "";
          panels.push(blockNode("tab", body, text || `Tab ${panels.length + 1}`));
        } else stray.push(child);
      }
      if (stray.length) opts.warn(RENDER_WARNING.TABS_INVALID, "Tabs may only contain :::tab[Label] blocks - other content was moved above the tabs");
      if (panels.length === 0) return stray;
      return [...stray, blockNode("tabs", panels)];
    }

    /** `:::code-group` of titled fences -> one tab per fence. */
    function codeGroup(node: MdNode): MdNode[] {
      const { rest } = splitLabel(node);
      const panels: MdNode[] = [];
      const stray: MdNode[] = [];
      for (const child of rest) {
        if (child.type === "code") {
          const { label, meta } = codeGroupLabel(child);
          child.meta = meta || null;
          panels.push(blockNode("tab", [child], label));
        } else stray.push(child);
      }
      if (stray.length) opts.warn(RENDER_WARNING.TABS_INVALID, "Tabs in :::code-group may only contain fenced code - other content was moved above the group");
      if (panels.length === 0) return stray;
      return [...stray, blockNode("code-tabs", panels)];
    }

    /** `:::steps` wraps one list, or splits its body at headings into steps. */
    function steps(node: MdNode): MdNode[] {
      const { rest } = splitLabel(node);
      const lists = rest.filter((c) => c.type === "list");
      if (lists.length === 1 && rest.length === 1) return [blockNode("steps", [{ ...lists[0]!, ordered: true } as MdNode])];
      const depth = rest.reduce(
        (min, c) => (c.type === "heading" ? Math.min(min, (c as MdNode & { depth: number }).depth) : min),
        Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(depth)) {
        opts.warn(RENDER_WARNING.STEPS_INVALID, "Steps need a numbered list or a heading per step - rendered as plain content");
        return rest;
      }
      const items: MdNode[] = [];
      const lead: MdNode[] = [];
      for (const child of rest) {
        const starts = child.type === "heading" && (child as MdNode & { depth: number }).depth === depth;
        if (starts) items.push({ type: "listItem", spread: true, children: [child] } as MdNode);
        else if (items.length) items[items.length - 1]!.children!.push(child);
        else lead.push(child);
      }
      return [...lead, blockNode("steps", [{ type: "list", ordered: true, spread: true, children: items } as MdNode])];
    }

    function packageInstall(node: MdNode): MdNode[] {
      const lines = (node.value ?? "").split("\n");
      if (lines.length > 20 || lines.some((line) => line.length > 500)) {
        opts.warn(RENDER_WARNING.PACKAGE_INSTALL_LIMIT, "Package install block exceeds 20 commands or 500 characters per command - shown as plain code");
        return [{ ...node, lang: "text" }];
      }
      return [
        blockNode(
          "code-tabs",
          PACKAGE_MANAGERS.map((pm) =>
            blockNode("tab", [{ type: "code", lang: "bash", meta: null, value: lines.map((l) => installCommand(l, pm)).join("\n") }], pm),
          ),
        ),
      ];
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
        if (node.type === "code" && node.lang?.toLowerCase() === "package-install") {
          replaceAt(children, i, packageInstall(node));
          continue;
        }
        if (node.type === "containerDirective" && !node.data?.hName) {
          const name = (node.name ?? "").toLowerCase();
          const { label, rest } = splitLabel(node);
          const kind = Object.hasOwn(DIRECTIVE_CALLOUTS, name) ? DIRECTIVE_CALLOUTS[name] : undefined;
          const generated =
            name === "tabs" ? tabs(node) : name === "code-group" ? codeGroup(node) : name === "steps" ? steps(node) : null;
          if (generated) {
            replaceAt(children, i, generated);
            // Revisit the generated nodes' bodies (nested directives), not the wrappers.
            for (const g of generated) visit(g);
            i += generated.length - 1;
            continue;
          }
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
            const hint = name === "tab" ? " (a :::tab belongs inside ::::tabs)" : "";
            opts.warn(RENDER_WARNING.DIRECTIVE_UNKNOWN, `Unknown block ":::${node.name ?? ""}"${hint} - rendered its content without a wrapper`);
            replaceAt(children, i, rest);
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

// ─── Heading markers: `## Setup {#setup}` and `## Aside [!toc]` ───────────

const HEADING_ID_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Strips trailing `{#id}` / `[!toc]` markers (either order). Hand-rolled end
 * scans instead of `\s*...$` regexes so long whitespace runs stay linear.
 */
export function parseHeadingMarkers(text: string): { text: string; id?: string; hide: boolean; invalidId?: string } {
  let rest = text.trimEnd();
  let id: string | undefined;
  let invalidId: string | undefined;
  let hide = false;
  for (let pass = 0; pass < 2; pass++) {
    if (!hide && rest.endsWith("[!toc]")) {
      hide = true;
      rest = rest.slice(0, -"[!toc]".length).trimEnd();
      continue;
    }
    if (id === undefined && invalidId === undefined && rest.endsWith("}")) {
      const at = rest.lastIndexOf("{#");
      if (at === -1 || rest.length - at > 80) break;
      const raw = rest.slice(at + 2, -1).trim();
      if (HEADING_ID_RE.test(raw.toLowerCase())) id = raw.toLowerCase();
      else invalidId = raw;
      if (id === undefined) break;
      rest = rest.slice(0, at).trimEnd();
      continue;
    }
    break;
  }
  return { text: rest, id, hide, invalidId };
}

function remarkHeadingMarkers(opts: { warn: Warn; customIds: Set<string> }) {
  return (tree: MdNode) => {
    (function visit(node: MdNode) {
      if (node.type === "heading") {
        const last = node.children?.[node.children.length - 1];
        if (last?.type === "text" && typeof last.value === "string") {
          const m = parseHeadingMarkers(last.value);
          if (m.invalidId !== undefined) {
            opts.warn(
              RENDER_WARNING.HEADING_ID_INVALID,
              `Invalid heading id "{#${m.invalidId.slice(0, 64)}}" - use lowercase letters, digits, and hyphens`,
            );
          }
          if (m.id !== undefined || m.hide) {
            last.value = m.text;
            const data = (node.data ??= {});
            const props: Record<string, unknown> = { ...(data.hProperties as object | undefined) };
            if (m.id !== undefined) {
              props.id = `h-${m.id}`;
              opts.customIds.add(`h-${m.id}`);
            }
            if (m.hide) props.dataVcToc = "hide";
            data.hProperties = props;
          }
        }
        return;
      }
      node.children?.forEach(visit);
    })(tree);
  };
}

/** Custom ids can collide with each other or with generated slugs; suffix and warn. */
function rehypeUniqueHeadingIds(opts: { warn: Warn; customIds: Set<string> }): (tree: UnistNode) => void {
  return (tree) => {
    if (opts.customIds.size === 0) return;
    const seen = new Set<string>();
    // Next suffix to try per base id, so N duplicates stay linear (not N^2).
    const nextSuffix = new Map<string, number>();
    const warned = new Set<string>();
    walkEl((tree as unknown as HRoot).children, (el) => {
      const id = el.properties.id;
      if (typeof id !== "string") return;
      if (!seen.has(id)) {
        seen.add(id);
        return;
      }
      let n = nextSuffix.get(id) ?? 1;
      while (seen.has(`${id}-${n}`)) n++;
      nextSuffix.set(id, n + 1);
      el.properties.id = `${id}-${n}`;
      seen.add(el.properties.id as string);
      if (opts.customIds.has(id) && !warned.has(id)) {
        warned.add(id);
        opts.warn(RENDER_WARNING.HEADING_ID_DUPLICATE, `Duplicate heading id "${id.slice(2)}" - later heading renamed to "${id.slice(2)}-${n}"`);
      }
    });
  };
}

// ─── Raw HTML: GitHub's allowlist survives, everything else warns ─────────

const RAW_HTML_ALLOWED = new Set((defaultSchema.tagNames ?? []).map((t) => t.toLowerCase()));

function remarkRawHtmlWarnings(opts: { warn: Warn }) {
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
      opts.warn(RENDER_WARNING.HTML_REMOVED, `HTML <${tag}> is not allowed in posts and was removed`);
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
/** Generated-only attributes: raw HTML may never carry these past rehype-raw. */
const GENERATED_ATTRS = ["id", "dataVcBlock", "dataVcLabel", "dataVcToc"] as const;

function rehypeMarkGeneratedIds(opts: { marker: string }): (tree: UnistNode) => void {
  return (tree) => {
    walkEl((tree as unknown as HRoot).children, (el) => {
      if (GENERATED_ATTRS.some((a) => el.properties[a] != null)) el.properties.dataVcGeneratedId = opts.marker;
    });
  };
}

function rehypeStripRawIds(opts: { marker: string }): (tree: UnistNode) => void {
  return (tree) => {
    walkEl((tree as unknown as HRoot).children, (el) => {
      const generated = el.properties.dataVcGeneratedId === opts.marker;
      delete el.properties.dataVcGeneratedId;
      if (!generated) for (const a of GENERATED_ATTRS) delete el.properties[a];
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

/** Heading text as rehype-slug saw it before typography: inline HTML tags are markup, not text. */
function headingSourceText(node: MdNode): string {
  if (node.type === "html") return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(headingSourceText).join("");
}

/** Keep the pre-typography spelling available only until rehype-slug runs. */
function remarkSaveHeadingText(saved: Map<string, string>, marker: string) {
  let next = 0;
  return (tree: MdNode) => {
    const pending = [tree];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.type === "heading") {
        const key = `${marker}-${next++}`;
        saved.set(key, headingSourceText(node));
        const data = (node.data ??= {});
        data.hProperties = { ...(data.hProperties as object | undefined), dataVcHeadingSource: key };
      }
      if (node.children) for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]!);
    }
  };
}

function rehypeOriginalHeadingSlugs(saved: Map<string, string>): (tree: UnistNode) => void {
  return (tree) => {
    const headings: Array<{ el: HElement; children: HNode[] }> = [];
    walkEl((tree as unknown as HRoot).children, (el) => {
      const key = el.properties.dataVcHeadingSource;
      delete el.properties.dataVcHeadingSource;
      if (typeof key !== "string" || !saved.has(key)) return;
      headings.push({ el, children: el.children });
      el.children = [{ type: "text", value: saved.get(key)! }];
    });
    // rehype-slug is invoked explicitly here while the original text is in place.
    rehypeSlug({ prefix: "h-" })(tree as never);
    for (const { el, children } of headings) el.children = children;
  };
}

/** Deepest element nesting any post may render; beyond it the post degrades to plain code. */
const MAX_TREE_DEPTH = 200;
/** One formula's MathML nesting; deeper formulas show as source like other invalid math. */
const MAX_MATH_DEPTH = 80;

class NestingLimitError extends Error {}

/**
 * Measure the parsed tree iteratively (so the check itself can't overflow) and
 * stop before later recursive visitors, sanitize, or React SSR walk it. Runs on
 * the real HTML parse, so implicit closes, `<div/>`, and code are all exact.
 */
function treeDeeperThan(root: UnistNode, max: number): boolean {
  const stack: Array<[UnistNode, number]> = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (depth > max) return true;
    const children = (node as { children?: UnistNode[] }).children;
    if (children) for (const child of children) stack.push([child, depth + 1]);
  }
  return false;
}

function rehypeDepthGuard(): () => (tree: UnistNode) => void {
  // A fresh attacher per call: unified dedupes a plugin used twice.
  return () => (tree) => {
    if (treeDeeperThan(tree, MAX_TREE_DEPTH)) throw new NestingLimitError("nesting limit");
  };
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
  wrap: boolean;
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
  const out: CodeMeta = { highlight: new Set(), lineNumbers: false, wrap: false };
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
  rest = rest.replace(/(?:^|\s)wrap(?=\s|$)/g, () => {
    out.wrap = true;
    return " ";
  });
  const bare = rest.trim().split(/\s+/)[0];
  if (!out.title && bare && /^[\w@~./-]+\.[\w-]+$|\//.test(bare) && !bare.includes("=")) {
    out.title = bare;
  }
  return out;
}

type LineMark = "add" | "remove" | "highlight" | "focus";

/** `[!code word:x]`: highlight `word` on lines `from..to` (inclusive). */
export interface WordMark {
  readonly word: string;
  readonly from: number;
  readonly to: number;
}

const NOTATION_KIND_RE =
  /^\[!code[ \t]+(?:(\+\+|--|highlight|hl|focus)(?::(\d{1,4}))?|word:([^\]:]{1,64})(?::(\d{1,4}))?)\][ \t]*(?:\*\/\}|-->|\*\/)?$/;
const NOTATION_COMMENTS = ["{/*", "<!--", "/*", "//", "--", "#", ";"];
/** Lines one marker may cover (`[!code highlight:N]`). */
const MAX_NOTATION_SPAN = 500;
/** `[!code word:x]` markers honored per block (each is checked against every line). */
const MAX_WORD_NOTATIONS = 32;

function trimEndBlank(s: string): string {
  let end = s.length;
  while (end > 0 && (s[end - 1] === " " || s[end - 1] === "\t")) end--;
  return s.slice(0, end);
}

interface Notation {
  kind: string;
  count: number | null;
  word?: string;
  cut: number;
}

/**
 * Parses a trailing `// [!code ++]` style marker. Hand-rolled (no unanchored
 * regex over the whole line) so adversarial whitespace stays linear.
 */
function parseNotation(line: string): Notation | null {
  const at = line.lastIndexOf("[!code");
  if (at === -1) return null;
  const m = NOTATION_KIND_RE.exec(trimEndBlank(line.slice(at)));
  if (!m) return null;
  const head = trimEndBlank(line.slice(0, at));
  const comment = NOTATION_COMMENTS.find((c) => head.endsWith(c));
  if (!comment) return null;
  const cut = trimEndBlank(head.slice(0, head.length - comment.length)).length;
  const countText = m[2] ?? m[4];
  const count = countText ? Math.min(Math.max(Number(countText), 1), MAX_NOTATION_SPAN) : null;
  const word = m[3]?.trim();
  if (m[3] !== undefined && !word) return null;
  return { kind: word ? "word" : m[1]!, count, word, cut };
}

/**
 * Strips `[!code ...]` markers and returns the line marks they declare. A
 * marker alone on its line (Shiki v3 style) is removed with its line and
 * applies to the following line(s); `:N` extends a marker over N lines.
 */
export function applyCodeNotation(code: string): { code: string; marks: Map<number, LineMark>; words: WordMark[] } {
  const marks = new Map<number, LineMark>();
  const words: WordMark[] = [];
  const out: string[] = [];
  for (const line of code.split("\n")) {
    const m = parseNotation(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const content = line.slice(0, m.cut);
    const standalone = content.trim() === "";
    const at = out.length + 1;
    if (!standalone) out.push(content);
    if (m.word) {
      if (words.length < MAX_WORD_NOTATIONS) words.push({ word: m.word, from: at, to: m.count ? at + m.count - 1 : Number.POSITIVE_INFINITY });
      continue;
    }
    const mark: LineMark = m.kind === "++" ? "add" : m.kind === "--" ? "remove" : m.kind === "focus" ? "focus" : "highlight";
    for (let n = 0; n < (m.count ?? 1); n++) marks.set(at + n, mark);
  }
  return { code: out.join("\n"), marks, words };
}

/** Word highlights wrapped per block, bounding work on adversarial input. */
const MAX_WORD_MARKS = 1000;

type TextSlot = { parent: HElement; index: number; node: HText; start: number };

/**
 * Wraps every occurrence of `word` in a line with `span.vc-code-word`. Works
 * on the flattened line text so matches may span Shiki tokens; each token
 * piece is wrapped separately (inside the token, so it keeps its color).
 */
function markWord(line: HElement, word: string, budget: { left: number }): void {
  const slots: TextSlot[] = [];
  let text = "";
  (function collect(el: HElement) {
    el.children.forEach((c, index) => {
      if (isTxt(c)) {
        slots.push({ parent: el, index, node: c, start: text.length });
        text += c.value;
      } else if (isEl(c)) collect(c);
    });
  })(line);
  const ranges: [number, number][] = [];
  for (let at = text.indexOf(word); at !== -1 && budget.left > 0; at = text.indexOf(word, at + word.length)) {
    ranges.push([at, at + word.length]);
    budget.left--;
  }
  if (!ranges.length) return;
  // Right to left, so earlier slots' indexes stay valid while splicing.
  for (let s = slots.length - 1; s >= 0; s--) {
    const { parent, index, node, start } = slots[s]!;
    const end = start + node.value.length;
    const pieces: HNode[] = [];
    let cursor = start;
    for (const [from, to] of ranges) {
      const a = Math.max(from, start);
      const b = Math.min(to, end);
      if (a >= b) continue;
      if (a > cursor) pieces.push({ type: "text", value: node.value.slice(cursor - start, a - start) } as HText);
      pieces.push(textEl("span", ["vc-code-word"], node.value.slice(a - start, b - start)));
      cursor = b;
    }
    if (!pieces.length) continue;
    if (cursor < end) pieces.push({ type: "text", value: node.value.slice(cursor - start) } as HText);
    parent.children.splice(index, 1, ...pieces);
  }
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

/** Mermaid source past this renders as a plain code block (client render cost). */
export const MERMAID_MAX_CHARS = 5000;

function resolveGrammar(lang: string): string {
  return Object.hasOwn(LANG_ALIASES, lang) ? LANG_ALIASES[lang]! : lang;
}

/** `` `fetch(){:ts}` ``: trailing `{:lang}` marks inline code for highlighting. */
const INLINE_LANG_RE = /\{:([a-zA-Z][\w+#-]{0,19})\}$/;

/** Inline code `{:lang}` highlighting; shares the per-render highlight budget. */
function highlightInlineCode(
  root: HRoot,
  opts: { highlighter?: CodeHighlighter | null; target: "web" | "feed" },
  budget: { left: number },
): void {
  (function visit(children: HNode[]) {
    for (const n of children) {
      if (!isEl(n) || n.tagName === "pre") continue;
      if (n.tagName !== "code") {
        visit(n.children);
        continue;
      }
      if (n.properties.className || n.children.length !== 1 || !isTxt(n.children[0]!)) continue;
      const text = (n.children[0] as HText).value;
      const m = INLINE_LANG_RE.exec(text);
      if (!m || m.index === 0) continue;
      const code = text.slice(0, m.index);
      n.children = [{ type: "text", value: code } as HText];
      if (opts.target === "feed") continue;
      const grammar = resolveGrammar(m[1]!.toLowerCase());
      if (code.length > budget.left || !opts.highlighter?.supports(grammar)) continue;
      budget.left -= code.length;
      const line = opts.highlighter.highlight(code, grammar)?.lines.find((l) => l.type === "element") as HElement | undefined;
      if (!line) continue;
      n.properties = { className: ["vc-shiki-inline"], dataLang: m[1] };
      n.children = line.children;
    }
  })(root.children);
}

function rehypeCodeBlocks(opts: { highlighter?: CodeHighlighter | null; target: "web" | "feed"; warn: Warn }) {
  return (tree: UnistNode) => {
    const budget = { left: HIGHLIGHT_CHAR_BUDGET };
    const wordBudget = { left: MAX_WORD_MARKS };
    highlightInlineCode(tree as unknown as HRoot, opts, budget);
    walkEl((tree as unknown as HRoot).children, (pre, i, siblings) => {
      if (pre.tagName !== "pre") return;
      const code = pre.children.find((c) => isElTag(c, "code")) as HElement | undefined;
      if (!code) return;
      const classes = (code.properties.className as string[] | undefined) ?? [];
      const rawLang = classes.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
      const lang = rawLang.toLowerCase();
      const meta = parseCodeMeta(typeof code.properties.dataMeta === "string" ? code.properties.dataMeta : "");
      const source = hastToText(code).replace(/\n$/, "");
      const { code: cleaned, marks, words } = applyCodeNotation(source);

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

      if (lang === "mermaid") {
        if (source.length <= MERMAID_MAX_CHARS) {
          // Source stays readable without JS; blocks.js swaps in the SVG.
          siblings[i] = {
            type: "element",
            tagName: "figure",
            properties: { className: ["vc-diagram"], dataVcDiagram: "mermaid" },
            children: [
              {
                type: "element",
                tagName: "pre",
                properties: { className: ["vc-diagram-source"], dataVcMermaid: true },
                children: [{ type: "text", value: source } as HText],
              },
            ],
          };
          return;
        }
        opts.warn(
          RENDER_WARNING.DIAGRAM_TOO_LARGE,
          `Diagram exceeds ${MERMAID_MAX_CHARS} characters - shown as source instead of a diagram`,
        );
      }

      const grammar = resolveGrammar(lang);
      const canHighlight =
        grammar && grammar !== "text" && cleaned.length <= budget.left && opts.highlighter?.supports(grammar);
      if (canHighlight) budget.left -= cleaned.length;
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
        for (const w of words) if (wordBudget.left > 0 && n >= w.from && n <= w.to) markWord(line, w.word, wordBudget);
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
          ...(meta.wrap ? { dataWrap: true } : {}),
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

// ─── Math (post-sanitize; KaTeX MathML is generated, not author HTML) ─────

/** TeX characters rendered per post; the rest falls back to source. */
export const MATH_CHAR_BUDGET = 20_000;

function rehypeMath(opts: { math?: MathRenderer | null; target: "web" | "feed"; warn: Warn }) {
  return (tree: UnistNode) => {
    let budget = MATH_CHAR_BUDGET;
    let overBudget = false;
    const render = (tex: string, display: boolean): HNode[] | null => {
      if (opts.target === "feed" || !opts.math) return null;
      if (tex.length > budget) {
        if (!overBudget) {
          overBudget = true;
          opts.warn(RENDER_WARNING.MATH_TOO_LARGE, `Math exceeds ${MATH_CHAR_BUDGET} characters per post - the rest is shown as source`);
        }
        return null;
      }
      budget -= tex.length;
      const out = opts.math.render(tex, display);
      if ("error" in out) {
        opts.warn(RENDER_WARNING.MATH_INVALID, `Math could not be rendered (${out.error}) - shown as source`);
        return null;
      }
      const nodes = out.nodes as unknown as HNode[];
      if (treeDeeperThan({ type: "root", children: nodes } as unknown as UnistNode, MAX_MATH_DEPTH)) {
        opts.warn(RENDER_WARNING.MATH_INVALID, "Math is nested too deeply to render - shown as source");
        return null;
      }
      return nodes;
    };
    const isMath = (el: HNode): boolean =>
      isElTag(el, "code") && ((el.properties.className as string[] | undefined) ?? []).includes("language-math");

    (function visit(children: HNode[]) {
      for (let i = 0; i < children.length; i++) {
        const n = children[i]!;
        if (!isEl(n)) continue;
        if (n.tagName === "pre") {
          const code = n.children.find(isMath) as HElement | undefined;
          if (!code) continue;
          const tex = hastToText(code).replace(/\n$/, "");
          const nodes = render(tex, true);
          if (nodes) {
            children[i] = {
              type: "element",
              tagName: "div",
              properties: { className: ["vc-math"], dataVcMath: "block" },
              children: nodes,
            };
          }
          continue;
        }
        if (isMath(n)) {
          const nodes = render(hastToText(n), false);
          if (nodes) {
            children[i] = { type: "element", tagName: "span", properties: { className: ["vc-math-inline"] }, children: nodes };
          }
          continue;
        }
        visit(n.children);
      }
    })((tree as unknown as HRoot).children);
  };
}

// ─── Generated blocks: tabs, steps (post-sanitize) ────────────────────────

function tabLabel(label: string): HElement {
  return textEl("p", ["vc-tab-label"], label);
}

function rehypeBlocks(opts: { target: "web" | "feed" }) {
  return (tree: UnistNode) => {
    (function visit(children: HNode[]) {
      for (let i = 0; i < children.length; i++) {
        const n = children[i]!;
        if (!isEl(n)) continue;
        visit(n.children);
        const kind = n.properties.dataVcBlock;
        if (typeof kind !== "string") continue;
        const label = typeof n.properties.dataVcLabel === "string" ? n.properties.dataVcLabel : "";
        let out: HNode[];
        if (kind === "tabs" || kind === "code-tabs") {
          const panels = n.children.filter((c): c is HElement => isEl(c) && c.properties.dataVcTabPanel === true);
          if (opts.target === "feed") {
            out = panels.flatMap((p) => p.children);
          } else {
            out = [
              {
                type: "element",
                tagName: "div",
                properties: { className: ["vc-tabs"], dataVcTabs: kind === "code-tabs" ? "code" : "" },
                children: panels.map((p) => {
                  const { dataVcTabPanel: _panel, ...props } = p.properties;
                  return { ...p, properties: props };
                }),
              },
            ];
          }
        } else if (kind === "tab") {
          // Marked for the enclosing tabs; label shown above the panel without JS / in feeds.
          const heading = opts.target === "feed"
            ? {
                type: "element",
                tagName: "p",
                properties: {},
                children: [{ type: "element", tagName: "strong", properties: {}, children: [{ type: "text", value: label }] }],
              } as HElement
            : tabLabel(label);
          out = [
            {
              type: "element",
              tagName: "section",
              properties: { className: ["vc-tab"], dataVcTab: label, dataVcTabPanel: true },
              children: [heading, ...n.children],
            },
          ];
        } else if (kind === "steps") {
          const list = n.children.find((c) => isElTag(c, "ol") || isElTag(c, "ul")) as HElement | undefined;
          out = list
            ? [{ ...list, tagName: "ol", properties: { ...list.properties, ...(opts.target === "web" ? { className: ["vc-steps"] } : {}) } }]
            : n.children;
        } else {
          out = n.children;
        }
        replaceAt(children, i, out);
        i += out.length - 1;
      }
    })((tree as unknown as HRoot).children);
  };
}

// ─── Tables (post-sanitize) ───────────────────────────────────────────────

function rehypeTables(opts: { target: "web" | "feed" }) {
  return (tree: UnistNode) => {
    (function visit(children: HNode[]) {
      for (let i = 0; i < children.length; i++) {
        const n = children[i]!;
        if (!isEl(n)) continue;
        if (n.tagName !== "table") {
          visit(n.children);
          continue;
        }
        // Headerless tables (`| | |` header row) drop the empty header.
        n.children = n.children.filter((c) => !(isElTag(c, "thead") && hastToText(c).trim() === ""));
        if (opts.target === "web") {
          children[i] = {
            type: "element",
            tagName: "div",
            properties: { className: ["vc-table-scroll"], tabIndex: 0, role: "region", ariaLabel: "Table" },
            children: [n],
          };
        }
      }
    })((tree as unknown as HRoot).children);
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

function isDarkOnlyImg(n: HNode): boolean {
  return isElTag(n, "img") && typeof n.properties.src === "string" && GH_MODE_FRAGMENT.exec(n.properties.src)?.[1] === "dark";
}

function rehypeImagePolish(opts: { zoom: boolean; target: "web" | "feed" }): (tree: UnistNode) => void {
  return (tree) => {
    (function visit(children: HNode[], inLink: boolean) {
      for (let i = 0; i < children.length; i++) {
        const n = children[i]!;
        if (!isEl(n)) continue;
        if (opts.target === "feed" && n.tagName === "figure" && n.children.some(isDarkOnlyImg)) {
          // A captioned dark-only image: drop the caption with it.
          children.splice(i, 1);
          i--;
          continue;
        }
        if (n.tagName === "img") {
          // GitHub's `#gh-dark-mode-only` / `#gh-light-mode-only`: shown per color scheme.
          const src = typeof n.properties.src === "string" ? n.properties.src : "";
          const mode = GH_MODE_FRAGMENT.exec(src);
          if (mode) {
            n.properties.src = src.slice(0, mode.index);
            if (opts.target === "feed" && mode[1] === "dark") {
              // Feed readers can't switch schemes; keep the light variant only.
              children.splice(i, 1);
              i--;
              continue;
            }
            if (opts.target === "web") n.properties.className = [mode[1] === "dark" ? "vc-img-dark" : "vc-img-light"];
          }
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
    // Generated-block placeholders; raw HTML can't carry these (see GENERATED_ATTRS).
    div: [...baseAttrs("div"), ["dataVcBlock", "tabs", "code-tabs", "tab", "steps"], "dataVcLabel"],
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
    h5: [...baseAttrs("h5"), "id"],
    h6: [...baseAttrs("h6"), "id"],
  },
};

export function renderRichContent(markdown: string, opts?: RenderOpts): RenderResult {
  const outline: OutlineEntry[] = [];
  const warnings: string[] = [];
  const warningCodes: RenderWarningCode[] = [];
  const warn: Warn = (code, message) => {
    warnings.push(message);
    warningCodes.push(code);
  };
  const fallback = (): RenderResult => {
    outline.length = 0;
    warn(RENDER_WARNING.NESTING_LIMIT, "Content nesting exceeds the renderer limit - shown as plain code");
    return { node: jsx("pre", { children: jsx("code", { children: markdown }) }), outline, warnings, warningCodes };
  };
  const target = opts?.target ?? "web";
  const math = opts?.math !== undefined ? opts.math : (opts?.highlighter?.math ?? null);
  const autolinkText = new Map<MdNode, string>();
  const headingText = new Map<string, string>();
  const customIds = new Set<string>();
  // Unguessable per render, so raw HTML can never forge a "generated" id.
  const idMarker = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    // `$$...$$` only: a single `$` in prose (prices) stays literal.
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkDirective)
    .use(remarkVcDirectives, { warn })
    .use(remarkHeadingMarkers, { warn, customIds })
    .use(remarkSaveHeadingText, headingText, idMarker)
    .use(remarkSaveAutolinkText, { saved: autolinkText })
    .use(remarkSmartypantsBounded)
    .use(remarkRestoreAutolinkText, { saved: autolinkText })
    .use(remarkRawHtmlWarnings, { warn })
    .use(remarkCodeMeta)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeDepthGuard())
    .use(rehypeMarkGeneratedIds, { marker: idMarker });
  // rehype-raw re-parses the whole tree (slow on very long posts); only posts
  // that could contain raw HTML need it. Without it no `raw` nodes survive
  // sanitize, so skipping is safe.
  if (/<[A-Za-z!/?]/.test(markdown)) pipeline.use(rehypeRaw).use(rehypeDepthGuard());
  pipeline.use(rehypeStripRawIds, { marker: idMarker });

  if (opts?.pageTitle) {
    pipeline.use(rehypeRemoveTitleH1, { pageTitle: opts.pageTitle });
  }

  if (opts?.resolveImage) {
    pipeline.use(rehypeResponsiveImages, { resolveImage: opts.resolveImage });
  }

  pipeline
    .use(rehypeDowngradeH1)
    .use(rehypeOriginalHeadingSlugs, headingText)
    .use(rehypeUniqueHeadingIds, { warn, customIds })
    .use(rehypeTocCollector, { outline, warn });
  if (target === "web") pipeline.use(rehypeHeadingAnchors);
  pipeline
    .use(rehypeExternalLinks)
    .use(rehypeCaptionedImages)
    .use(rehypeValidateImageAlt, { warn })
    .use(rehypeCallouts, { warn })
    .use(rehypeSanitize, sanitizeSchema as Parameters<typeof rehypeSanitize>[0])
    .use(rehypeMath, { math, target, warn })
    .use(rehypeCodeBlocks, { highlighter: opts?.highlighter, target, warn })
    .use(rehypeBlocks, { target })
    .use(rehypeTables, { target })
    .use(rehypeImagePolish, { zoom: target === "web", target });
  if (target === "web") pipeline.use(rehypeEmbeds);
  if (target === "feed" && opts?.baseUrl) pipeline.use(rehypeAbsoluteUrls, { baseUrl: opts.baseUrl });

  // Generated blocks (math, code, embeds) are injected after the early guards.
  pipeline.use(rehypeDepthGuard());
  let file;
  try {
    file = pipeline.use(rehypeReact, { Fragment, jsx, jsxs }).processSync(markdown);
  } catch (error) {
    // Anything deeper than the guard allows, or deep enough to overflow a
    // recursive parser step before the guard runs, degrades instead of 500ing.
    if (error instanceof NestingLimitError || (error instanceof RangeError && /stack|recursion/i.test(error.message))) return fallback();
    throw error;
  }

  const node = file.result as unknown as ReactNode;
  return { node, outline, warnings, warningCodes };
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
