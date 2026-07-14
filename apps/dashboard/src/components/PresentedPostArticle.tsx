import type { CSSProperties } from "react";
import prose from "@vc/content/styles/prose";
import { RichContentFrame, type RenderResult } from "@vc/content";
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
  /** Author byline prepended to the meta line as "By {byline}" (By … · date · Updated … · N min read). */
  byline?: string;
  coverAssetSrc?: string;
  dateText?: string;
  updatedDateText?: string;
  /** Estimated reading time in minutes (render-level, no DB column). */
  readingMinutes?: number;
  /** Post tags rendered as a quiet text-link row under the meta line (§2.3). */
  tags?: string[];
  /** Base path used to build per-tag links. Required when `tags` is supplied. */
  basePath?: string;
  /** Per-site accent/font/mode; injected as CSS vars + data-vc-mode on the root. */
  theme?: SiteThemeInput;
}

/**
 * Shared presented article layer.
 * Used by PublicBlogPostView (SSR), previewPostOp (renderToStaticMarkup),
 * and the dashboard editor preview (client).
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
  dateText,
  updatedDateText,
  readingMinutes,
  tags,
  basePath,
  theme,
}: PresentedPostArticleProps) {
  // Theme Customizer (Layer 2): inject per-site accent/font vars + forced mode
  // on the article root; they cascade into RichContentFrame's [data-rich-content].
  const themeAttrs = theme ? resolveSiteTheme(theme) : undefined;

  const isFeature = presentation.layout === "feature";
  const { outline } = renderResult;
  // §3: page-level ToC renders only when the preset supports it AND there are
  // >=3 outline entries. (Previously any single heading triggered it.)
  const hasToc = presentation.toc && outline.length >= 3;

  // §2: ONE quiet middle-dot meta line — byline · date · Updated … · N min read. No icons, no labels.
  const metaSegments: string[] = [
    byline ? `By ${byline}` : undefined,
    dateText,
    updatedDateText ? `Updated ${updatedDateText}` : undefined,
    readingMinutes != null ? `${readingMinutes} min read` : undefined,
  ].filter((s): s is string => Boolean(s));
  const metaLine =
    metaSegments.length > 0 ? <p className={styles.metaLine}>{metaSegments.join(" \u00b7 ")}</p> : null;

  // §2.3 / §6: quiet sentence-case tag row (plain text links, dot-separated, not pills).
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

  // Editorial deck/lede: a larger muted intro paragraph between the title and meta.
  const deck = excerpt ? <p className={styles.articleDeck}>{excerpt}</p> : null;

  // Shared outline list — rendered twice (desktop rail + mobile <details>). React element
  // descriptions are reusable; the per-item `key` is scoped to each list instance.
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
      {...(themeAttrs?.mode === "light" || themeAttrs?.mode === "dark"
        ? { "data-vc-mode": themeAttrs.mode }
        : {})}
    >
      <header className={styles.articleHeader}>
        {tagRow}
        {title ? <h1 className={styles.articleTitle}>{title}</h1> : null}
        {deck}
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
      {/* §3: mobile/narrow ToC — native <details>, collapsed, no box. Hidden when the rail is shown. */}
      {hasToc ? (
        <details className={styles.tocDetails}>
          <summary className={styles.tocSummary}>On this page</summary>
          {tocList}
        </details>
      ) : null}
      {/* Body: prose column + sticky right rail (rail shown only when the shell is wide enough). */}
      <div className={styles.articleBody}>
        <RichContentFrame node={renderResult.node} presetId={presetId} mode={themeAttrs?.mode} className={prose.prose} />
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
