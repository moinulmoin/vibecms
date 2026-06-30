import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { canonicalHostRedirect } from '~/server/canonical-host.server'

// Server functions are the cookie-authed mutation surface (createPost, updateSiteSettings,
// createApiKey, publishPost, revokeApiKey, billing checkout/portal, ...). TanStack's server-fn
// handler performs no Origin validation and a simple cross-origin form POST to /_serverFn/<id>
// reaches the action, so without this guard any logged-in user visiting a hostile page could be
// made to mint a full-scope agent token or mutate their blog. The default check rejects anything
// whose Sec-Fetch-Site is not `same-origin` (so same-site blog subdomains, which render
// agent-authored content, cannot drive dashboard mutations either).
//
// The filter scopes the check to server functions only. Router handlers stay untouched on purpose:
// `/mcp` and `/api/posts` are Bearer-authed agent surfaces that are legitimately cross-origin, and
// `/api/polar/webhook` is HMAC-signed. Cookie-authed router routes guard themselves in-handler
// (`/api/onboarding/ensure`, `/api/media/upload`).
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

// Canonicalize hosts (app surfaces -> app host) before the CSRF guard; see canonical-host.server.ts.
const hostMiddleware = createMiddleware().server((ctx) => canonicalHostRedirect(ctx.request) ?? ctx.next())

export const startInstance = createStart(() => ({
  requestMiddleware: [hostMiddleware, csrfMiddleware],
}))
