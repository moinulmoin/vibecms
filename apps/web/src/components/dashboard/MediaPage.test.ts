import { describe, expect, it, vi } from 'vitest'

vi.mock('~/server/dashboard-pages-fn', () => ({
  loadMediaPage: vi.fn(),
  updateMediaAltMutation: vi.fn(),
}))

import { selectedFileFeedback } from './MediaPage'

describe('MediaPage file selection feedback', () => {
  it('confirms the selected image name', () => {
    expect(selectedFileFeedback([{ name: 'cover-image.png' }])).toBe('Selected: cover-image.png')
  })

  it('summarizes multi-file drops without losing feedback', () => {
    expect(selectedFileFeedback([{ name: 'one.png' }, { name: 'two.png' }])).toBe('2 images selected')
  })
})
