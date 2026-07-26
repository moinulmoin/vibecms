import { scheduleArticlePurge } from "@/server/purge-scheduler";

/** Dedupe nullable article slugs while preserving first-seen order. */
export function uniqueArticlePurgeSlugs(...slugs: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** Schedule Cache API / tag purges for every distinct live article slug. */
export function scheduleLiveArticlePurges(
  siteId: string,
  siteSlug: string,
  ...slugs: Array<string | null | undefined>
) {
  for (const slug of uniqueArticlePurgeSlugs(...slugs)) {
    scheduleArticlePurge(siteId, siteSlug, slug);
  }
}

type PublishedSlugSource = {
  getPost(siteId: string, postId: string): Promise<{ publishedVersionNumber: number | null } | null>;
  getPostVersion(
    siteId: string,
    postId: string,
    versionNumber: number,
  ): Promise<{ slug: string } | null>;
};

/**
 * Capture the slug currently pinned for public/cache URLs.
 * Call this before publish/archive so a tip slug rename still invalidates the old live path.
 */
export async function resolvePublishedVersionSlug(
  repo: PublishedSlugSource,
  siteId: string,
  postId: string,
): Promise<string | null> {
  const post = await repo.getPost(siteId, postId);
  if (!post?.publishedVersionNumber) return null;
  const version = await repo.getPostVersion(siteId, postId, post.publishedVersionNumber);
  return version?.slug ?? null;
}
