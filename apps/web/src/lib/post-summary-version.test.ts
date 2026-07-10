import { describe, it, expect } from 'vitest'
import { mapPostSummary } from '@vc/api-contract'

describe('public post summary boundary', () => {
  it('does not expose dashboard-only version metadata', () => {
    const postSummary = {
      id: 'post-1',
      siteId: 'site-1',
      title: 'Test Post',
      slug: 'test-post',
      excerpt: 'Test excerpt',
      coverAssetId: null,
      status: 'draft' as const,
      publishedAt: null,
      tags: ['tag1'],
      createdAt: 1234567890,
      updatedAt: 1234567890,
    }

    expect(mapPostSummary(postSummary, 'https://example.com/test-post')).not.toHaveProperty('versionNumber')
  })
})
