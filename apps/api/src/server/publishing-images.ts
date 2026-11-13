import { AppError, NotFoundError } from '@vc/core'
import { MISSING_IMAGE_ALT_WARNING } from '@vc/content/constants'
import { createDataAccess } from '@vc/db'
import { env } from 'cloudflare:workers'

export async function assertPostImagesPublishable(siteId: string, postId: string, versionNumber?: number): Promise<void> {
  const data = createDataAccess(env.DB)
  const post = versionNumber === undefined
    ? await data.posts.getPost(siteId, postId)
    : await data.posts.getPostVersion(siteId, postId, versionNumber)
  if (!post) throw new NotFoundError('Post not found')

  if (post.coverAssetId) {
    const cover = await data.assets.getAsset(siteId, post.coverAssetId)
    if (!cover) throw new AppError('INVALID_COVER_ASSET', 'Nothing was published: the featured image is not in this blog\'s media library. Choose an image from the library, then publish again.', 400)
    if (!cover.altText) {
      throw new AppError('IMAGE_ALT_REQUIRED', 'Nothing was published: the featured image has no alt text. Give it a short description, then publish again.', 400)
    }
  }

  const { validateRichContent } = await import('@vc/content')
  if (validateRichContent(post.contentMarkdown).includes(MISSING_IMAGE_ALT_WARNING)) {
    throw new AppError('IMAGE_ALT_REQUIRED', 'Nothing was published: an image in the post has no alt text. Describe each image in the Markdown, as ![description](url), then publish again.', 400)
  }
}
