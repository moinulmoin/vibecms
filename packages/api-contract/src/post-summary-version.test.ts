import { describe, expect, it } from 'vitest'
import { mapPostSummary } from './index'

describe('public post summary boundary', () => {
  it('does not expose dashboard-only version metadata', () => {
    const result = mapPostSummary(
      {
        id: 'post-1',
        siteId: 'site-1',
        title: 'Test Post',
        slug: 'test-post',
        excerpt: 'Test excerpt',
        coverAssetId: null,
        status: 'draft',
        publishedAt: null,
        tags: ['tag1'],
        createdAt: 1234567890,
        updatedAt: 1234567890,
      },
      'https://example.com/test-post',
    )

    expect(result).not.toHaveProperty('versionNumber')
  })
})
