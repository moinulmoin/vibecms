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