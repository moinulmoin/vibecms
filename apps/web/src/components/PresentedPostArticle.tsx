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
}: PresentedPostArticleProps) {
  const isFeature = presentation.layout === "feature";
  const { outline } = renderResult;
  const hasToc = presentation.toc && outline.length > 0;
  const hasHeroChrome = Boolean(title || dateText || updatedDateText || coverAssetSrc);
  const datesBlock = (
    <>
      {dateText ? <p className={styles.date}>{dateText}</p> : null}
      {updatedDateText ? <p className={styles.date}>Updated {updatedDateText}</p> : null}
    </>
  );

  return (
    <article className={styles.article} data-vc-layout={presentation.layout}>
      {isFeature ? (
        hasHeroChrome ? (
          // Feature: full-width cover hero above title
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
            {datesBlock}
          </div>
        ) : null
      ) : (
        // Standard / essay: title first, then optional cover, then date
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
          {datesBlock}
        </>
      )}
      {hasToc ? (
        <nav className={styles.tocBlock} aria-label="Table of contents">
          <ul className={styles.tocList}>
            {outline.map((entry) => (
              <li
                key={entry.id}
                className={entry.depth === 3 ? styles.tocItemH3 : styles.tocItemH2}
              >
                <a href={`#${entry.id}`}>{entry.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <RichContentFrame node={renderResult.node} presetId={presetId} />
    </article>
  );
}
