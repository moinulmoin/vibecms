import { describe, expect, it } from 'vitest'
import {
  createPostRequestSchema,
  previewPostRequestSchema,
  restorePostVersionRequestSchema,
  updatePostRequestSchema,
} from './index'

const fullPost = {
  title: 'Test Post',
  slug: 'test-post',
  excerpt: 'Test excerpt',
  contentMarkdown: '# Test\n\nContent',
  tags: ['tag1', 'tag2'],
  coverAssetId: 'asset-123',
  canonicalUrl: 'https://example.com/canonical',
  seoTitle: 'SEO Title',
  seoDescription: 'SEO Description',
  presentation: { layout: 'standard' as const, toc: true },
}

describe('createPostRequestSchema', () => {
  it.each([
    ['all supported fields', fullPost],
    ['minimal fields', { title: 'Test Post', slug: 'test-post', contentMarkdown: '# Test' }],
    [
      'nullable fields',
      { title: 'Test Post', slug: 'test-post', contentMarkdown: '# Test', coverAssetId: null, canonicalUrl: null },
    ],
    ['null presentation', { title: 'Test Post', slug: 'test-post', contentMarkdown: '# Test', presentation: null }],
  ])('accepts %s', (_name, value) => {
    expect(createPostRequestSchema.safeParse(value).success).toBe(true)
  })
})

describe('updatePostRequestSchema', () => {
  it.each([
    ['all supported fields', { postId: 'post-123', expectedVersionNumber: 1, ...fullPost }],
    ['post id and expected version only', { postId: 'post-123', expectedVersionNumber: 2 }],
    [
      'nullable fields',
      { postId: 'post-123', expectedVersionNumber: 3, coverAssetId: null, canonicalUrl: null },
    ],
    ['null presentation', { postId: 'post-123', expectedVersionNumber: 1, presentation: null }],
  ])('accepts %s', (_name, value) => {
    expect(updatePostRequestSchema.safeParse(value).success).toBe(true)
  })

  it.each([
    ['missing expectedVersionNumber', { postId: 'post-123', title: 'Updated' }],
    ['non-positive expectedVersionNumber', { postId: 'post-123', expectedVersionNumber: 0 }],
    ['non-integer expectedVersionNumber', { postId: 'post-123', expectedVersionNumber: 1.5 }],
  ])('rejects %s', (_name, value) => {
    expect(updatePostRequestSchema.safeParse(value).success).toBe(false)
  })
})

describe('restorePostVersionRequestSchema', () => {
  it('accepts postId, versionNumber, and expectedVersionNumber', () => {
    expect(
      restorePostVersionRequestSchema.safeParse({
        postId: 'post-123',
        versionNumber: 1,
        expectedVersionNumber: 4,
      }).success,
    ).toBe(true)
  })

  it.each([
    ['missing expectedVersionNumber', { postId: 'post-123', versionNumber: 1 }],
    ['non-positive expectedVersionNumber', { postId: 'post-123', versionNumber: 1, expectedVersionNumber: 0 }],
  ])('rejects %s', (_name, value) => {
    expect(restorePostVersionRequestSchema.safeParse(value).success).toBe(false)
  })
})

describe('previewPostRequestSchema', () => {
  it.each([
    [
      'presentation',
      { contentMarkdown: '# Test\n\nContent', presetId: 'default', presentation: { layout: 'standard', toc: true } },
    ],
    ['null presentation', { contentMarkdown: '# Test\n\nContent', presentation: null }],
    ['minimal fields', { contentMarkdown: '# Test\n\nContent' }],
  ])('accepts %s', (_name, value) => {
    expect(previewPostRequestSchema.safeParse(value).success).toBe(true)
  })
})
