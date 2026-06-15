import { createServerFn } from '@tanstack/react-start'
import type { BillingStatus } from '@vc/core'
import {
  createCheckoutSessionForApp,
  createPortalSessionForApp,
  getBilling,
  isSelfHosted,
  type BillingSnapshot,
  type CheckoutInterval,
} from '~/server/billing'
import { resolveAppRouterContext } from '~/server/resolve-app-router-context.server'

async function requireApp() {
  const ctx = await resolveAppRouterContext()
  if (!ctx.app) throw new Error('UNAUTHORIZED')
  return ctx.app
}

export type BillingPageLoadResult =
  | {
      selfHosted: true
      isOwner: boolean
      billing: { status: BillingStatus; currentPeriodEnd: null }
    }
  | {
      selfHosted: false
      isOwner: boolean
      billing: BillingSnapshot
    }

export const loadBillingPage = createServerFn({ method: 'GET' }).handler(async (): Promise<BillingPageLoadResult> => {
  const app = await requireApp()
  const isOwner = app.actor.type === 'human' && app.actor.role === 'owner'
  if (isSelfHosted()) {
    return {
      selfHosted: true,
      isOwner,
      billing: { status: 'active', currentPeriodEnd: null },
    }
  }
  const billing = await getBilling(app.workspaceId)
  return {
    selfHosted: false,
    isOwner,
    billing,
  }
})

export const checkoutBillingMutation = createServerFn({ method: 'POST' })
  .validator((data: { interval: CheckoutInterval }) => data)
  .handler(async ({ data }) => {
    const app = await requireApp()
    return createCheckoutSessionForApp(app, data.interval)
  })

export const portalBillingMutation = createServerFn({ method: 'POST' }).handler(async () => {
  const app = await requireApp()
  return createPortalSessionForApp(app)
})