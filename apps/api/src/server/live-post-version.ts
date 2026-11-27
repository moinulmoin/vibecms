import type { PostVersion } from '@vc/core'
import { createD1PostRepository } from '@vc/db'

/** The version readers see right now: published, publish time reached, pinned. */
export async function readLiveVersion(db: D1Database, siteId: string, postId: string): Promise<PostVersion | null> {
  const repo = createD1PostRepository(db)
  const post = await repo.getPost(siteId, postId)
  if (post?.status !== 'published' || !post.publishedVersionNumber) return null
  if (post.publishedAt === null || post.publishedAt > Date.now() / 1000) return null
  return repo.getPostVersion(siteId, postId, post.publishedVersionNumber)
}
