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

/** The blog index list: one calm row per post, the whole row is the link. */
export function PublicPostList({ posts }: { posts: PublicPostListItem[] }) {
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
            <p className={styles.postMeta}>
              {post.publishedAt ? (
                <time dateTime={postDateIso(post.publishedAt)}>{formatPostDate(post.publishedAt)}</time>
              ) : null}
              {(post.tags ?? []).slice(0, 3).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </p>
          </div>
          {post.cover ? (
            <img
              className={styles.postThumb}
              src={post.cover.src}
              srcSet={post.cover.srcSet}
              sizes="(max-width: 640px) 100vw, 160px"
              alt=""
              width={post.cover.width ?? 320}
              height={post.cover.height ?? 200}
              loading="lazy"
              decoding="async"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
