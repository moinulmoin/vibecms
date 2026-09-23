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
import type { OutlineEntry } from "./types.js";
import styles from "./presented-post.module.css";

/** Raw per-site theme fields, threaded from the site row. */
export interface SiteThemeInput {
  accent: string | null;
  font: string | null;
  mode: string | null;
}

/**
 * Resolve a site's theme into inline CSS custom properties + color mode for the
 * theming root. vc-rich-content.css picks --vc-accent-light/--vc-accent-dark per
 * color-scheme and reads --vc-font-body/--vc-font-heading from these. (React 19
 * CSSProperties has no custom-property index signature, hence the cast.)
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

/** Same theme as a plain attribute map for a non-React root (e.g. Astro <html>). */
export function siteThemeRootAttributes(presetId: string, theme: SiteThemeInput): Record<string, string> {
  const { style, mode } = resolveSiteTheme(theme);
  const css = Object.entries(style as Record<string, string>)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return {
    "data-vc-theme": presetId,
    ...(mode === "light" || mode === "dark" ? { "data-vc-mode": mode } : {}),
    style: css,
  };
}

/** Page-level ToC shows when the post asks for it and has at least 3 entries. */
export function articleHasToc(presentation: ResolvedPresentation, outline: readonly OutlineEntry[]): boolean {
  return presentation.toc && outline.length >= 3;
}

/** Stable, locale-independent post date ("Sep 24, 2026") in UTC. */
export function formatPostDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function postDateIso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

export interface AdjacentPostLink {
  title: string;
  href: string;
}

export interface PresentedPostArticleProps {
  renderResult: RenderResult;
  presetId: string;
  presentation: ResolvedPresentation;
  title?: string;
  /** Deck: larger muted intro between title and meta. */
  excerpt?: string;
  /** Author byline; omit when it would just repeat the site name. */
  byline?: string;
  coverAssetSrc?: string;
  coverAssetAlt?: string;
  coverAssetWidth?: number;
  coverAssetHeight?: number;
  coverAssetSrcSet?: string;
  coverAssetSizes?: string;
  coverAssetLoading?: "eager" | "lazy";
  coverAssetFetchPriority?: "high" | "low" | "auto";
  /** Epoch seconds; renders a <time>. */
  publishedAt?: number | null;
  /** Epoch seconds; only pass when the update is worth showing. */
  updatedAt?: number | null;
  /** Legacy preformatted date strings (used when the epoch values are absent). */
  dateText?: string;
  updatedDateText?: string;
  readingMinutes?: number;
  tags?: string[];
  /** Base path used to build per-tag links. Required when `tags` is supplied. */
  basePath?: string;
  theme?: SiteThemeInput;
  newer?: AdjacentPostLink | null;
  older?: AdjacentPostLink | null;
}

/**
 * Shared presented article: public SSR and the dashboard preview render this
 * exact tree. No server-only imports.
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
  publishedAt,
  updatedAt,
  dateText,
  updatedDateText,
  readingMinutes,
  tags,
  basePath,
  theme,
  newer,
  older,
}: PresentedPostArticleProps) {
  const themeAttrs = theme ? resolveSiteTheme(theme) : undefined;
  const isFeature = presentation.layout === "feature";
  const { outline } = renderResult;
  const hasToc = articleHasToc(presentation, outline);

  const published =
    publishedAt != null ? (
      <time dateTime={postDateIso(publishedAt)}>{formatPostDate(publishedAt)}</time>
    ) : dateText ? (
      <span>{dateText}</span>
    ) : null;
  const updated =
    updatedAt != null ? (
      <span>
        Updated <time dateTime={postDateIso(updatedAt)}>{formatPostDate(updatedAt)}</time>
      </span>
    ) : updatedDateText ? (
      <span>Updated {updatedDateText}</span>
    ) : null;
  const metaParts = [
    byline ? <span key="by">{byline}</span> : null,
    published ? <span key="date">{published}</span> : null,
    readingMinutes != null ? <span key="read">{readingMinutes} min read</span> : null,
    updated ? <span key="upd">{updated}</span> : null,
  ].filter(Boolean);

  const tagRow =
    tags && tags.length > 0 && basePath != null ? (
      <ul className={styles.tagRow} aria-label="Tags">
        {tags.map((tag) => (
          <li key={tag}>
            <a href={`${basePath}/tag/${encodeURIComponent(tag)}`} className={styles.tagLink}>
              {tag}
            </a>
          </li>
        ))}
      </ul>
    ) : null;

  const tocList = (
    <ul className={styles.tocList}>
      {outline.map((entry) => (
        <li key={entry.id} className={entry.depth === 3 ? styles.tocItemH3 : styles.tocItemH2}>
          <a href={`#${entry.id}`} data-vc-toc-link={entry.id}>
            {entry.text}
          </a>
        </li>
      ))}
    </ul>
  );

  const cover = coverAssetSrc ? (
    <img
      className={isFeature ? styles.featureCover : styles.heroImage}
      src={coverAssetSrc}
      alt={coverAssetAlt ?? ""}
      width={coverAssetWidth ?? 1200}
      height={coverAssetHeight ?? 630}
      srcSet={coverAssetSrcSet}
      sizes={coverAssetSizes}
      loading={coverAssetLoading ?? (isFeature ? "eager" : "lazy")}
      fetchPriority={coverAssetFetchPriority}
      decoding="async"
    />
  ) : null;

  return (
    <article
      className={styles.article}
      data-vc-theme={presetId}
      data-vc-layout={presentation.layout}
      data-vc-has-toc={hasToc ? "" : undefined}
      style={themeAttrs?.style}
      {...(themeAttrs?.mode === "light" || themeAttrs?.mode === "dark" ? { "data-vc-mode": themeAttrs.mode } : {})}
    >
      {isFeature ? cover : null}
      <header className={styles.articleHeader}>
        {title ? <h1 className={styles.articleTitle}>{title}</h1> : null}
        {excerpt ? <p className={styles.articleDeck}>{excerpt}</p> : null}
        {metaParts.length > 0 ? <p className={styles.metaLine}>{metaParts}</p> : null}
        {tagRow}
      </header>
      {isFeature ? null : cover}
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
      {hasToc ? (
        <details className={styles.tocPill}>
          <summary className={styles.tocPillSummary}>
            <span className={styles.tocPillIcon} aria-hidden="true" />
            On this page
          </summary>
          <div className={styles.tocPillPanel}>{tocList}</div>
        </details>
      ) : null}
      {newer || older ? (
        <nav className={styles.adjacent} aria-label="More posts">
          {newer ? (
            <a className={styles.adjacentLink} href={newer.href} rel="prev">
              <span className={styles.adjacentLabel}>Newer</span>
              <span className={styles.adjacentTitle}>{newer.title}</span>
            </a>
          ) : (
            <span />
          )}
          {older ? (
            <a className={`${styles.adjacentLink} ${styles.adjacentOlder}`} href={older.href} rel="next">
              <span className={styles.adjacentLabel}>Older</span>
              <span className={styles.adjacentTitle}>{older.title}</span>
            </a>
          ) : null}
        </nav>
      ) : null}
    </article>
  );
}
