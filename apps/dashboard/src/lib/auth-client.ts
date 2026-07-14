import { createAuthClient } from 'better-auth/react'
import { emailOTPClient } from 'better-auth/client/plugins'

export function setupAuthClient() {
  return createAuthClient({
    baseURL: window.location.origin,
    basePath: '/api/auth',
    plugins: [emailOTPClient()],
  })
}