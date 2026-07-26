import { describe, expect, it } from 'vitest'
import { rejectCrossOriginBrowserPost } from '@/server/csrf'

describe('csrf', () => {
  it('allows same-origin POST with Origin header', () => {
    const req = new Request('https://app.example.com/api/dashboard/posts/create', {
      method: 'POST',
      headers: { origin: 'https://app.example.com' },
    })
    expect(rejectCrossOriginBrowserPost(req)).toBeUndefined()
  })

  it('blocks cross-origin POST', () => {
    const req = new Request('https://app.example.com/api/dashboard/posts/create', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    expect(rejectCrossOriginBrowserPost(req)?.status).toBe(403)
  })
})