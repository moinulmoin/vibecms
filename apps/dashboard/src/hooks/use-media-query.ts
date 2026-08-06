import * as React from 'react'

/**
 * Track a media query. Unlike use-mobile (sidebar, 768px, undefined first
 * paint), this reads matchMedia lazily so the FIRST paint already matches the
 * device — the dashboard is a client-only SPA, so window is always available
 * and there is no SSR mismatch to guard against.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(() => window.matchMedia(query).matches)
  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}
