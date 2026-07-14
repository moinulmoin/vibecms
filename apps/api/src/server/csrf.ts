function headerHost(value: string) {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

function isSameOriginBrowserPost(request: Request) {
  const expectedHost = new URL(request.url).host.toLowerCase()
  const origin = request.headers.get('origin')
  if (origin) return headerHost(origin) === expectedHost

  const referer = request.headers.get('referer')
  if (referer) return headerHost(referer) === expectedHost

  // No Origin/Referer: require explicit same-origin (same-site would let tenant subdomains drive mutations).
  return request.headers.get('sec-fetch-site') === 'same-origin'
}

export function rejectCrossOriginBrowserPost(request: Request) {
  if (isSameOriginBrowserPost(request)) return undefined
  return new Response('Forbidden', { status: 403 })
}