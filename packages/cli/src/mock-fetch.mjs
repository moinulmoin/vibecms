import { appendFileSync } from 'node:fs'

globalThis.fetch = async (url, options = {}) => {
  if (process.env.VC_FETCH_LOG) appendFileSync(process.env.VC_FETCH_LOG, `${options.method ?? 'GET'} ${url}\n`)
  if (process.env.VC_FETCH_THROW) throw new Error('offline')
  const status = Number(process.env.VC_FETCH_STATUS ?? 200)
  const body = process.env.VC_FETCH_BODY ?? '{}'
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}
