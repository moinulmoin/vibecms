import { describe, expect, it } from 'vitest'
import { editorLiveState, shouldShowPublishAction } from './PostEditorPage'

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

describe('editorLiveState', () => {
  it('is new when there is no post', () => {
    expect(editorLiveState(null, null)).toBe('new')
  })

  it('is draft until the first publish, whatever the version numbers say', () => {
    expect(editorLiveState({ status: 'draft', publishedVersionNumber: null }, 1)).toBe('draft')
    expect(editorLiveState({ status: 'draft', publishedVersionNumber: null }, 7)).toBe('draft')
  })

  it('is archived regardless of version state', () => {
    expect(editorLiveState({ status: 'archived', publishedVersionNumber: 2 }, 2)).toBe('archived')
    expect(editorLiveState({ status: 'archived', publishedVersionNumber: 2 }, 5)).toBe('archived')
  })

  it('is live only when the saved tip equals the pinned public version', () => {
    expect(editorLiveState(publishedPost, 3)).toBe('live')
  })

  it('is unpublished when the saved tip is ahead of (or missing) the pinned version', () => {
    expect(editorLiveState(publishedPost, 4)).toBe('unpublished')
    expect(editorLiveState({ status: 'published', publishedVersionNumber: null }, 1)).toBe('unpublished')
  })
})
