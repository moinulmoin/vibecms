import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/api-client', () => ({
  archivePostMutation: vi.fn(),
  loadPostsPage: vi.fn(),
  publishPostMutation: vi.fn(),
}))

import { postListRefreshError } from './PostsPage'

describe('PostsPage mutation refresh feedback', () => {
  it('reports a completed mutation separately from a list refresh failure', () => {
    expect(postListRefreshError('publish')).toBe('Post published, but the list could not refresh.')
    expect(postListRefreshError('archive')).toBe('Post archived, but the list could not refresh.')
  })
})
