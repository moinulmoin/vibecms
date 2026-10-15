import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_LOGGED_CAUSE_DEPTH, logUnhandledException, serializeErrorForLog } from './request-logging'

afterEach(() => vi.restoreAllMocks())

describe('serializeErrorForLog', () => {
  it('redacts message, stack and every cause', () => {
    const root = new Error('db failed token=raw-root-token', { cause: new Error('upstream failed with Bearer vc_live_inner') })
    const text = JSON.stringify(serializeErrorForLog(new Error('outer otp=123456', { cause: root })))
    for (const secret of ['raw-root-token', 'vc_live_inner', '123456']) expect(text).not.toContain(secret)
    expect(serializeErrorForLog(root)).toMatchObject({
      name: 'Error',
      message: 'db failed token=[redacted]',
      stack: expect.stringContaining('token=[redacted]'),
      cause: { name: 'Error', message: 'upstream failed with Bearer [redacted]' },
    })
  })

  it('redacts credentials written as JSON or quoted keys', () => {
    const text = JSON.stringify(serializeErrorForLog(new Error('upstream said {"token":"raw-json-token","password": "pw-1"} and \'api_key\'=k-2')))
    for (const secret of ['raw-json-token', 'pw-1', 'k-2']) expect(text).not.toContain(secret)
  })

  it('bounds deep cause chains and cycles', () => {
    let deep: unknown = new Error('leaf')
    for (let index = 0; index < 50; index += 1) deep = new Error(`level ${index}`, { cause: deep })
    let node = serializeErrorForLog(deep)
    for (let depth = 0; depth < MAX_LOGGED_CAUSE_DEPTH; depth += 1) {
      expect(node.cause).toHaveProperty('name', 'Error')
      node = node.cause as typeof node
    }
    expect(node.cause).toEqual({ truncated: true })

    const cyclic = new Error('cyclic')
    cyclic.cause = cyclic
    expect(serializeErrorForLog(cyclic).cause).toEqual({ truncated: true })
  })

  it('caps text and handles non-Error throws and hostile getters', () => {
    expect(serializeErrorForLog(new Error('x'.repeat(10_000))).message).toHaveLength(2_000)
    expect(serializeErrorForLog('password=hunter2')).toEqual({ name: 'string', message: 'password=[redacted]' })
    const hostile = new Error('hostile')
    Object.defineProperty(hostile, 'cause', { get() { throw new Error('boom') } })
    expect(serializeErrorForLog(hostile).cause).toMatchObject({ name: 'string', message: '[unreadable cause]' })
  })
})

describe('logUnhandledException', () => {
  it('writes one structured line with request id and redacted path', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    logUnhandledException({
      surface: 'rest',
      requestId: 'req-123',
      method: 'POST',
      url: 'https://app.vibecms.dev/preview/secret-preview-token?x=1',
      error: new Error('failed', { cause: new Error('inner') }),
    })
    expect(errorLog).toHaveBeenCalledTimes(1)
    const line = String(errorLog.mock.calls[0]?.[0])
    expect(line).not.toContain('secret-preview-token')
    expect(JSON.parse(line)).toMatchObject({
      level: 'error',
      event: 'unhandled_exception',
      surface: 'rest',
      requestId: 'req-123',
      path: '/preview/[redacted]',
      error: { message: 'failed', cause: { message: 'inner' } },
    })
  })
})
