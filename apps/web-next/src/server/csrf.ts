function headerHost(value: string) {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

function isSameSiteFetchMetadata(value: string | null) {
  return value === 'same-origin' || value === 'same-site' || value === 'none'
}

function isSameOriginBrowserPost(request: Request) {
  const expectedHost = new URL(request.url).host.toLowerCase()
  const origin = request.headers.get('origin')
  if (origin) return headerHost(origin) === expectedHost

  const referer = request.headers.get('referer')
  if (referer) return headerHost(referer) === expectedHost

  return isSameSiteFetchMetadata(request.headers.get('sec-fetch-site'))
}

export function rejectCrossOriginBrowserPost(request: Request) {
  if (isSameOriginBrowserPost(request)) return undefined
  return new Response('Forbidden', { status: 403 })
}