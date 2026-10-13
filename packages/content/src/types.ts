import type { ReactNode } from "react";
import type { RenderWarningCode } from "./constants.js";

export type { RenderWarningCode };

export interface OutlineEntry {
  readonly depth: number;
  readonly text: string;
  readonly id: string;
}

export interface RenderResult {
  readonly node: ReactNode;
  readonly outline: OutlineEntry[];
  readonly warnings: string[];
  /** Stable codes for `warnings`, index-aligned (see RENDER_WARNING). */
  readonly warningCodes: RenderWarningCode[];
}

export interface RenderedImageAttributes {
  readonly src?: string;
  readonly srcSet?: string;
  readonly sizes?: string;
  /** Intrinsic size; emitted as width/height so the page reserves space. */
  readonly width?: number;
  readonly height?: number;
}

/** One Shiki-highlighted line list; each line is a HAST `span.line`. */
export interface HighlightedCode {
  readonly lines: readonly { type: string; [key: string]: unknown }[];
}

/** Injectable syntax highlighter (see `@vc/content/highlight`). */
export interface CodeHighlighter {
  supports(lang: string): boolean;
  highlight(code: string, lang: string): HighlightedCode | null;
  /** Math renderer shipped alongside the highlighter; used when `RenderOpts.math` is unset. */
  readonly math?: MathRenderer | null;
}

/** Rendered math: HAST nodes (trusted, generated) or the parse error. */
export type RenderedMath =
  | { readonly nodes: readonly { type: string; [key: string]: unknown }[] }
  | { readonly error: string };

/** Injectable TeX renderer (see `@vc/content/math`). */
export interface MathRenderer {
  render(tex: string, displayMode: boolean): RenderedMath;
}

export interface RenderOpts {
  readonly presetId?: string;
  /**
   * Syntax highlighter for fenced code. Omit for plain (still framed) code;
   * public pages pass the bundled Shiki highlighter, the dashboard lazy-loads it.
   */
  readonly highlighter?: CodeHighlighter | null;
  /**
   * TeX renderer for `$$...$$` / ```math. Defaults to `highlighter.math`;
   * pass null to force the plain-source fallback.
   */
  readonly math?: MathRenderer | null;
  /**
   * "feed" drops interactive chrome (copy buttons, heading anchors) and makes
   * relative URLs absolute against `baseUrl`, for RSS `content:encoded`.
   */
  readonly target?: "web" | "feed";
  /** Absolute URL of the rendered page; required for `target: "feed"`. */
  readonly baseUrl?: string;
  readonly className?: string;
  /**
   * When set (nonempty), a leading top-level H1 whose normalized visible text
   * exactly matches this title is removed (not downgraded to H2). Normalization
   * collapses whitespace and trims; matching is case-sensitive and exact. All
   * other H1s retain the existing downgrade-to-H2 behavior.
   */
  readonly pageTitle?: string;
  /**
   * Resolves safe presentation attributes for an image source. Public delivery
   * uses this for bounded responsive media variants; previews may omit it.
   */
  readonly resolveImage?: (src: string) => RenderedImageAttributes | null;
  /**
   * Subpath hosting (plan 022): root-relative links whose first path segment
   * is one of `postSlugs` get this prefix ("/blog"); other root-relative links
   * keep their normal meaning (the customer site's root).
   */
  readonly postBasePath?: string;
  /** Published slugs of the blog; used with `postBasePath`. */
  readonly postSlugs?: ReadonlySet<string>;
  /**
   * Origin/media base for `/media-assets/*` URLs. On a proxied blog this is
   * the asset host (our domain), so media loads straight from it.
   */
  readonly assetOrigin?: string;
}

export interface RichContentFrameProps {
  readonly node: ReactNode;
  readonly presetId?: string;
  readonly mode?: "light" | "dark" | "system";
  /** Optional layout class (e.g. app prose module) merged onto the theming root. */
  readonly className?: string;
}

export interface ValidateRichContentOpts {
  readonly renderWarnings?: string[];
  readonly hasPageToc?: boolean;
}

/** Best-effort source position carried through remark-parse into hast. */
export interface SeoMarkdownPosition {
  readonly start?: { readonly offset?: number };
}

/**
 * Structural hast types for the tree `parseSeoMarkdown` returns (plan 024):
 * remark-parse + GFM + remark-rehype, with raw HTML re-parsed only when the
 * Markdown contains tags. SEO checks and link collection walk this shape;
 * code fences never reach it as elements.
 */
export interface SeoMarkdownElement {
  readonly type: "element";
  readonly tagName: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly children: readonly SeoMarkdownNode[];
  readonly position?: SeoMarkdownPosition;
}

export interface SeoMarkdownText {
  readonly type: "text";
  readonly value: string;
}

export type SeoMarkdownNode =
  | SeoMarkdownElement
  | SeoMarkdownText
  | { readonly type: string; readonly value?: string };

export interface SeoMarkdownTree {
  readonly type: "root";
  readonly children: readonly SeoMarkdownNode[];
}