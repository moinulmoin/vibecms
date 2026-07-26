import { AppError, NotFoundError } from '@vc/core'
import { MISSING_IMAGE_ALT_WARNING, validateRichContent } from '@vc/content'
import { createDataAccess } from '@vc/db'
import { env } from 'cloudflare:workers'

export async function assertPostImagesPublishable(siteId: string, postId: string): Promise<void> {
  const data = createDataAccess(env.DB)
  const post = await data.posts.getPost(siteId, postId)
  if (!post) throw new NotFoundError('Post not found')

  if (post.coverAssetId) {
    const cover = await data.assets.getAsset(siteId, post.coverAssetId)
    if (!cover) throw new AppError('INVALID_COVER_ASSET', 'Featured image must belong to this site', 400)
    if (!cover.altText) {
      throw new AppError('IMAGE_ALT_REQUIRED', 'Add alt text to the featured image before publishing', 400)
    }
  }

  if (validateRichContent(post.contentMarkdown).includes(MISSING_IMAGE_ALT_WARNING)) {
    throw new AppError('IMAGE_ALT_REQUIRED', 'Add alt text to every inline image before publishing', 400)
  }
}
