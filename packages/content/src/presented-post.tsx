import type { CSSProperties } from "react";
import {
  getAccent,
  getFont,
  resolveAccent,
  resolveFont,
  resolveMode,
  type ResolvedPresentation,
  type ThemeMode,
} from "@vc/config";
import prose from "./styles/prose.module.css";
import { RichContentFrame, type RenderResult } from "./renderer.js";
import styles from "./presented-post.module.css";

/** Raw per-site theme fields, threaded from the site row. */
export interface SiteThemeInput {
  accent: string | null;
  font: string | null;
  mode: string | null;
}

/**
 * Resolve a site's theme into inline CSS custom properties + color mode for the
 * theming root. The var-bridge in vc-rich-content.css / presets.css selects
 * --vc-accent-light/--vc-accent-dark per mode and consumes --vc-font-body/
 * --vc-font-heading from these. (React 19 CSSProperties has no custom-property
 * index signature, hence the cast.)
 */
export function resolveSiteTheme(theme: SiteThemeInput): {
  style: CSSProperties;
  mode: ThemeMode;
} {
  const accent = getAccent(resolveAccent(theme.accent));
  const font = getFont(resolveFont(theme.font));
  const mode = resolveMode(theme.mode);
  const style = {
    "--vc-accent-light": accent.oklchLight,
    "--vc-accent-dark": accent.oklchDark,
    "--vc-font-body": font.bodyStack,
    "--vc-font-heading": font.headingStack,
  } as CSSProperties;
  return { style, mode };
}

export interface PresentedPostArticleProps {
  renderResult: RenderResult;
  presetId: string;
  presentation: ResolvedPresentation;
  title?: string;
  /** Editorial deck/lede: larger muted intro paragraph between title and meta. */
  excerpt?: string;
  /** Author byline prepended to the meta line as "By {byline}". */
  byline?: string;
  coverAssetSrc?: string;
  coverAssetAlt?: string;
  coverAssetWidth?: number;
  coverAssetHeight?: number;
  /** Native img srcSet for responsive covers. */
  coverAssetSrcSet?: string;
  /** Native img sizes for responsive covers. */
  coverAssetSizes?: string;
  /** Native img loading; defaults to eager for feature layout, lazy otherwise. */
  coverAssetLoading?: "eager" | "lazy";
  /** Native img fetchPriority when provided. */
  coverAssetFetchPriority?: "high" | "low" | "auto";
  dateText?: string;
  updatedDateText?: string;
  /** Estimated reading time in minutes (render-level, no DB column). */
  readingMinutes?: number;
  /** Post tags rendered as a quiet text-link row under the meta line. */
  tags?: string[];
  /** Base path used to build per-tag links. Required when `tags` is supplied. */
  basePath?: string;
  /** Per-site accent/font/mode; injected as CSS vars + data-vc-mode on the root. */
  theme?: SiteThemeInput;
}

/**
 * Shared presented article layer.
 * Used by public SSR, preview serialization, and the dashboard editor preview.
 * No server-only imports; safe for all surfaces.
 */
export function PresentedPostArticle({
  renderResult,
  presetId,
  presentation,
  title,
  excerpt,
  byline,
  coverAssetSrc,
  coverAssetAlt,
  coverAssetWidth,
  coverAssetHeight,
  coverAssetSrcSet,
  coverAssetSizes,
  coverAssetLoading,
  coverAssetFetchPriority,
  dateText,
  updatedDateText,
  readingMinutes,
  tags,
  basePath,
  theme,
}: PresentedPostArticleProps) {
  const themeAttrs = theme ? resolveSiteTheme(theme) : undefined;
  const isFeature = presentation.layout === "feature";
  const { outline } = renderResult;
  // Page-level ToC only when the preset supports it AND there are >=3 outline entries.
  const hasToc = presentation.toc && outline.length >= 3;
  const metaSegments: string[] = [
    byline ? `By ${byline}` : undefined,
    dateText,
    updatedDateText ? `Updated ${updatedDateText}` : undefined,
    readingMinutes != null ? `${readingMinutes} min read` : undefined,
  ].filter((s): s is string => Boolean(s));
  const metaLine =
    metaSegments.length > 0 ? <p className={styles.metaLine}>{metaSegments.join(" \u00b7 ")}</p> : null;
  const tagRow =
    tags && tags.length > 0 && basePath != null ? (
      <p className={styles.tagRow}>
        {tags.map((tag, i) => (
          <span key={tag} className={styles.tagEntry}>
            <a href={`${basePath}/tag/${encodeURIComponent(tag)}`} className={styles.tagLink}>
              {tag}
            </a>
            {i < tags.length - 1 ? <span className={styles.tagSep}>{"\u00b7"}</span> : null}
          </span>
        ))}
      </p>
    ) : null;
  // Shared outline list — rendered twice (desktop rail + mobile <details>).
  const tocList = (
    <ul className={styles.tocList}>
      {outline.map((entry) => (
        <li key={entry.id} className={entry.depth === 3 ? styles.tocItemH3 : styles.tocItemH2}>
          <a href={`#${entry.id}`}>{entry.text}</a>
        </li>
      ))}
    </ul>
  );

  return (
    <article
      className={styles.article}
      data-vc-layout={presentation.layout}
      data-vc-has-toc={hasToc ? "" : undefined}
      style={themeAttrs?.style}
      {...(themeAttrs?.mode === "light" || themeAttrs?.mode === "dark" ? { "data-vc-mode": themeAttrs.mode } : {})}
    >
      <header className={styles.articleHeader}>
        {title ? <h1 className={styles.articleTitle}>{title}</h1> : null}
        {excerpt ? <p className={styles.articleDeck}>{excerpt}</p> : null}
        {metaLine}
        {tagRow}
      </header>
      {coverAssetSrc ? (
        <img
          className={isFeature ? styles.featureCover : styles.heroImage}
          src={coverAssetSrc}
          alt={coverAssetAlt ?? (title ? `Cover for ${title}` : "Cover image")}
          width={coverAssetWidth ?? 860}
          height={coverAssetHeight ?? 520}
          srcSet={coverAssetSrcSet}
          sizes={coverAssetSizes}
          loading={coverAssetLoading ?? (isFeature ? "eager" : "lazy")}
          fetchPriority={coverAssetFetchPriority}
          decoding="async"
        />
      ) : null}
      {hasToc ? (
        <details className={styles.tocDetails}>
          <summary className={styles.tocSummary}>On this page</summary>
          {tocList}
        </details>
      ) : null}
      <div className={styles.articleBody}>
        <RichContentFrame
          node={renderResult.node}
          presetId={presetId}
          mode={themeAttrs?.mode}
          className={prose.prose}
        />
        {hasToc ? (
          <nav className={styles.tocRail} aria-label="On this page">
            <p className={styles.tocRailLabel}>On this page</p>
            {tocList}
          </nav>
        ) : null}
      </div>
    </article>
  );
}
