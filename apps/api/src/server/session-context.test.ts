import { describe, expect, it } from 'vitest'
import type { AppRouterContext } from './auth-context-types'
import { rejectChangedSite } from './session-context'

const context = {
  app: { siteId: 'site-a' },
} as AppRouterContext

function request(expected?: string) {
  return new Request('https://app.basedui.dev/api/dashboard/posts/create', {
    method: 'POST',
    headers: expected === undefined ? {} : { 'x-vc-expected-site': expected },
  })
}

describe('session site selection guard', () => {
  it('allows a matching site and an absent header', () => {
    expect(rejectChangedSite(request('site-a'), context)).toBeUndefined()
    expect(rejectChangedSite(request(), context)).toBeUndefined()
  })

  it('returns a stable 409 envelope before the write runs', async () => {
    let writes = 0
    const guardedWrite = async (req: Request) => {
      const rejected = rejectChangedSite(req, context)
      if (rejected) return rejected
      writes++
      return Response.json({ ok: true })
    }
    const response = await guardedWrite(request('site-b'))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'site_changed', message: 'Selected site changed' } })
    expect(writes).toBe(0)
  })
})
