import type { ReactNode } from "react";

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

export interface RenderedImageAttributes {
  readonly src?: string;
  readonly srcSet?: string;
  readonly sizes?: string;
}

/** One Shiki-highlighted line list; each line is a HAST `span.line`. */
export interface HighlightedCode {
  readonly lines: readonly { type: string; [key: string]: unknown }[];
}

/** Injectable syntax highlighter (see `@vc/content/highlight`). */
export interface CodeHighlighter {
  supports(lang: string): boolean;
  highlight(code: string, lang: string): HighlightedCode | null;
}

export interface RenderOpts {
  readonly presetId?: string;
  /**
   * Syntax highlighter for fenced code. Omit for plain (still framed) code;
   * public pages pass the bundled Shiki highlighter, the dashboard lazy-loads it.
   */
  readonly highlighter?: CodeHighlighter | null;
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