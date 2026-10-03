import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { AppShell } from '~/components/dashboard/DashboardLayout'
import { onDashboardSiteChanged, suspendDashboardMutations } from '~/lib/api-client'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { contextQuery } from '~/lib/queries'

export const Route = createFileRoute('/dashboard')({
  ssr: false,
  beforeLoad: ({ context }) => {
    if (!context.app) {
      throw redirect({ to: '/login' })
    }
    if (!context.siteSetupComplete) {
      throw redirect({ to: '/dashboard/setup', search: emptyDashboardStatusSearch })
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const routeContext = Route.useRouteContext()
  // Read through the cache so a rename or refresh shows up without navigating.
  const { data } = useQuery({ ...contextQuery, initialData: routeContext })
  const { app, apps, siteDisplayName } = data
  const original = useRef(routeContext.app)
  const [switchedSite, setSwitchedSite] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const first = original.current
    if (switchedSite || !first || !app) return
    if (app.siteId !== first.siteId || app.workspaceId !== first.workspaceId || app.user.id !== first.user.id) {
      setSwitchedSite(apps.find((choice) => choice.siteId === app.siteId)?.siteName ?? siteDisplayName ?? 'another site')
      suspendDashboardMutations()
    }
  }, [app, apps, siteDisplayName, switchedSite])

  useEffect(() => {
    const first = original.current
    if (!first) return
    const unsubscribe = onDashboardSiteChanged(() => setSwitchedSite((site) => site ?? 'another site'))
    const onSelection = (event: StorageEvent) => {
      if (event.key !== 'vc-dashboard-selection' || !event.newValue) return
      try {
        const selection = JSON.parse(event.newValue) as { workspaceId: string; siteId: string; siteName: string }
        if (selection.workspaceId === first.workspaceId && selection.siteId === first.siteId) return
        setSwitchedSite(selection.siteName)
        suspendDashboardMutations()
      } catch { /* Ignore malformed storage from another source. */ }
    }
    window.addEventListener('storage', onSelection)
    return () => {
      unsubscribe()
      window.removeEventListener('storage', onSelection)
    }
  }, [switchedSite])

  // A background refresh found the session gone (signed out elsewhere): leave.
  useEffect(() => {
    if (!app) void navigate({ to: '/login', replace: true })
  }, [app, navigate])

  return (
    <AppShell
      siteName={siteDisplayName ?? undefined}
      userEmail={app?.user.email}
      apps={apps}
      currentWorkspaceId={app?.workspaceId}
      currentSiteId={app?.siteId}
      currentRole={app?.actor.role}
    >
      {switchedSite && (
        <section role="alert" className="mx-auto max-w-xl py-12">
          <h1 className="text-xl font-semibold">You switched to {switchedSite} in another tab</h1>
          <p className="mt-2 text-sm text-muted-foreground">Changes are paused. Copy any unsaved text before reloading.</p>
          <button type="button" className="mt-4 text-sm text-primary underline" onClick={() => window.location.reload()}>Reload</button>
        </section>
      )}
      <Outlet />
    </AppShell>
  )
}
