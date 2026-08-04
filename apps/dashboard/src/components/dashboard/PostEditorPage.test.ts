import { describe, expect, it } from 'vitest'
import { shouldShowPublishAction } from './PostEditorPage'

const publishedPost = {
  status: 'published' as const,
  publishedVersionNumber: 3,
}

describe('PostEditorPage publish action', () => {
  it('offers to publish when the saved tip differs from the pinned public version', () => {
    expect(shouldShowPublishAction(publishedPost, 4)).toBe(true)
    expect(shouldShowPublishAction(publishedPost, 3)).toBe(false)
  })
})
