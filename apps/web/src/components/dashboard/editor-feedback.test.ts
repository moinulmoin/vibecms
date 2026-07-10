import { describe, expect, it } from 'vitest'
import { isPreviewCurrent } from './MarkdownEditor'
import { resolveFormStatus } from './useFormStatusFromSearch'

describe('dashboard form-status feedback', () => {
  it.each([
    ['post_created', 'Post created'],
    ['post_saved', 'Changes saved'],
    ['post_published', 'Post published'],
    ['post_archived', 'Post archived'],
  ])('resolves the allowlisted %s success status', (code, title) => {
    expect(resolveFormStatus({ ok: code })).toMatchObject({ variant: 'success', title })
  })

  it('renders an allowlisted conflict before any success status', () => {
    expect(resolveFormStatus({ ok: 'post_saved', error: 'version_conflict' })).toMatchObject({
      variant: 'error',
      title: 'Post changed',
      message: 'Review the latest version, then publish again.',
    })
  })

  it('keeps unknown error feedback generic and does not show unknown success codes', () => {
    expect(resolveFormStatus({ error: 'untrusted-message' })).toMatchObject({
      variant: 'error',
      title: 'Something went wrong',
    })
    expect(resolveFormStatus({ ok: 'untrusted-message' })).toBeNull()
  })
})

describe('Markdown preview freshness', () => {
  it('is current only when both Markdown and post metadata match the rendered snapshot', () => {
    expect(isPreviewCurrent(2, 2, 4, 4)).toBe(true)
    expect(isPreviewCurrent(3, 3, 4, 4)).toBe(true)
    expect(isPreviewCurrent(3, 2, 4, 4)).toBe(false)
    expect(isPreviewCurrent(2, 2, 5, 4)).toBe(false)
  })
})
