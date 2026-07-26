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

export interface RenderOpts {
  readonly presetId?: string;
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