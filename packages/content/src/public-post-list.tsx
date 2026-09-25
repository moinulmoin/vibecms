import { formatPostDate, postDateIso } from "./presented-post.js";
import styles from "./public-post-list.module.css";

export interface PublicPostListItem {
  id: string;
  title: string;
  href: string;
  excerpt?: string | null;
  /** Epoch seconds. */
  publishedAt?: number | null;
  tags?: string[];
  cover?: { src: string; srcSet?: string; width?: number | null; height?: number | null } | null;
}

export type PublicPostListVariant = "list" | "grid" | "compact";

function PostMeta({ post }: { post: PublicPostListItem }) {
  return (
    <p className={styles.postMeta}>
      {post.publishedAt ? (
        <time dateTime={postDateIso(post.publishedAt)}>{formatPostDate(post.publishedAt)}</time>
      ) : null}
      {(post.tags ?? []).slice(0, 3).map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </p>
  );
}

function Cover({ post, sizes }: { post: PublicPostListItem; sizes: string }) {
  if (!post.cover) return null;
  return (
    <img
      className={styles.postThumb}
      src={post.cover.src}
      srcSet={post.cover.srcSet}
      sizes={sizes}
      alt=""
      width={post.cover.width ?? 640}
      height={post.cover.height ?? 400}
      loading="lazy"
      decoding="async"
    />
  );
}

/** A cover stand-in for grids, so posts without images still look designed. */
function Tile({ post }: { post: PublicPostListItem }) {
  const label = post.tags?.[0] ?? (post.publishedAt ? formatPostDate(post.publishedAt) : "");
  return (
    <div className={styles.tile} aria-hidden="true">
      <span className={styles.tileMark}>{post.title.trim().charAt(0).toUpperCase()}</span>
      {label ? <span className={styles.tileLabel}>{label}</span> : null}
    </div>
  );
}

function monthKey(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return "Undated";
  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shortDate(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return "";
  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The blog index. The template picks the variant: a calm list, a magazine grid
 * with a lead story, or a compact archive grouped by month. Every row/card is
 * one link (the title), stretched over the whole item.
 */
export function PublicPostList({
  posts,
  variant = "list",
}: {
  posts: PublicPostListItem[];
  variant?: PublicPostListVariant;
}) {
  if (variant === "compact") {
    const groups = new Map<string, PublicPostListItem[]>();
    for (const post of posts) {
      const key = monthKey(post.publishedAt);
      groups.set(key, [...(groups.get(key) ?? []), post]);
    }
    return (
      <div className={styles.archive}>
        {[...groups].map(([month, items]) => (
          <section key={month} className={styles.archiveGroup}>
            <h2 className={styles.archiveMonth}>{month}</h2>
            <ol className={styles.archiveList}>
              {items.map((post) => (
                <li key={post.id} className={styles.archiveItem}>
                  {post.publishedAt ? (
                    <time className={styles.archiveDate} dateTime={postDateIso(post.publishedAt)}>
                      {shortDate(post.publishedAt)}
                    </time>
                  ) : (
                    <span className={styles.archiveDate} />
                  )}
                  <a href={post.href} className={styles.archiveLink}>
                    {post.title}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    );
  }

  if (variant === "grid") {
    return (
      <ol className={styles.grid}>
        {posts.map((post, index) => {
          const lead = index === 0;
          return (
            <li className={`${styles.card} ${lead ? styles.cardLead : ""}`} key={post.id}>
              <div className={styles.cardMedia}>
                {post.cover ? (
                  <Cover post={post} sizes={lead ? "(max-width: 900px) 100vw, 900px" : "(max-width: 640px) 100vw, 420px"} />
                ) : (
                  <Tile post={post} />
                )}
              </div>
              <div className={styles.cardText}>
                {lead ? (
                  <h2 className={styles.cardTitle}>
                    <a href={post.href} className={styles.postLink}>
                      {post.title}
                    </a>
                  </h2>
                ) : (
                  <h3 className={styles.cardTitle}>
                    <a href={post.href} className={styles.postLink}>
                      {post.title}
                    </a>
                  </h3>
                )}
                {post.excerpt ? <p className={styles.postExcerpt}>{post.excerpt}</p> : null}
                <PostMeta post={post} />
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className={styles.postList}>
      {posts.map((post) => (
        <li className={styles.postItem} key={post.id}>
          <div className={styles.postText}>
            <h2 className={styles.postTitle}>
              <a href={post.href} className={styles.postLink}>
                {post.title}
              </a>
            </h2>
            {post.excerpt ? <p className={styles.postExcerpt}>{post.excerpt}</p> : null}
            <PostMeta post={post} />
          </div>
          <Cover post={post} sizes="(max-width: 640px) 100vw, 160px" />
        </li>
      ))}
    </ol>
  );
}
