import type { CSSProperties } from "react";
import type { RenderResult } from "@vc/content";
import { RichContentFrame } from "@vc/content";
import prose from "@vc/content/styles/prose";
import {
  getAccent,
  getFont,
  resolveAccent,
  resolveFont,
  resolveMode,
  type ResolvedPresentation,
  type ThemeMode,
} from "@vc/config";
import styles from "./public-blog.module.css";

export interface SiteThemeInput {
  accent: string | null;
  font: string | null;
  mode: string | null;
}

export function resolveSiteTheme(theme: SiteThemeInput): { style: CSSProperties; mode: ThemeMode } {
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
  excerpt?: string;
  byline?: string;
  coverAssetSrc?: string;
  dateText?: string;
  updatedDateText?: string;
  readingMinutes?: number;
  tags?: string[];
  basePath?: string;
  theme?: SiteThemeInput;
}

export function PresentedPostArticle({
  renderResult,
  presetId,
  presentation,
  title,
  excerpt,
  byline,
  coverAssetSrc,
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
        {tagRow}
        {title ? <h1 className={styles.articleTitle}>{title}</h1> : null}
        {excerpt ? <p className={styles.articleDeck}>{excerpt}</p> : null}
        {metaLine}
      </header>
      {coverAssetSrc ? (
        <img
          className={isFeature ? styles.featureCover : styles.heroImage}
          src={coverAssetSrc}
          alt={title ? `Cover for ${title}` : "Cover image"}
          width={860}
          height={520}
          loading={isFeature ? "eager" : "lazy"}
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