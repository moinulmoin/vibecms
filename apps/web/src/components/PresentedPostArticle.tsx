import styles from "./public-blog.module.css";
import { RichContentFrame, type RenderResult } from "~/lib/markdown";
import type { ResolvedPresentation } from "@vc/config";

export interface PresentedPostArticleProps {
  renderResult: RenderResult;
  presetId: string;
  presentation: ResolvedPresentation;
  title?: string;
  coverAssetSrc?: string;
  dateText?: string;
  updatedDateText?: string;
  /** Estimated reading time in minutes (render-level, no DB column). */
  readingMinutes?: number;
  /** Post tags rendered as a quiet text-link row under the meta line (§2.3). */
  tags?: string[];
  /** Base path used to build per-tag links. Required when `tags` is supplied. */
  basePath?: string;
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
  coverAssetSrc,
  dateText,
  updatedDateText,
  readingMinutes,
  tags,
  basePath,
}: PresentedPostArticleProps) {
  const isFeature = presentation.layout === "feature";
  const { outline } = renderResult;
  // §3: page-level ToC renders only when the preset supports it AND there are
  // >=3 outline entries. (Previously any single heading triggered it.)
  const hasToc = presentation.toc && outline.length >= 3;
  const hasHeroChrome = Boolean(title || dateText || updatedDateText || coverAssetSrc);

  // §2: ONE quiet middle-dot meta line — date · Updated … · N min read. No icons, no labels.
  const metaSegments: string[] = [
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
    <article className={styles.article} data-vc-layout={presentation.layout}>
      {isFeature ? (
        hasHeroChrome ? (
          // Feature: full-width cover hero above title; only the cover breaks out (§7).
          <div className={styles.featureHero}>
            {coverAssetSrc ? (
              <img
                className={styles.featureCover}
                src={coverAssetSrc}
                alt={title ? `Cover for ${title}` : "Cover image"}
                width={860}
                height={520}
                loading="eager"
              />
            ) : null}
            {title ? <h1 className={styles.articleTitle}>{title}</h1> : null}
            {metaLine}
            {tagRow}
          </div>
        ) : null
      ) : (
        // Standard / essay: title first, then optional cover, then meta + tags.
        <>
          {title ? <h1 className={styles.articleTitle}>{title}</h1> : null}
          {coverAssetSrc ? (
            <img
              className={styles.heroImage}
              src={coverAssetSrc}
              alt={title ? `Cover for ${title}` : "Cover image"}
              width={860}
              height={520}
              loading="lazy"
            />
          ) : null}
          {metaLine}
          {tagRow}
        </>
      )}
      {/* §3: mobile/narrow ToC — native <details>, collapsed, no box. Hidden >=1100px. */}
      {hasToc ? (
        <details className={styles.tocDetails}>
          <summary className={styles.tocSummary}>On this page</summary>
          {tocList}
        </details>
      ) : null}
      {/* Body: prose column + sticky right rail (rail shown only >=1100px via CSS). */}
      <div className={styles.articleBody}>
        <RichContentFrame node={renderResult.node} presetId={presetId} />
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
