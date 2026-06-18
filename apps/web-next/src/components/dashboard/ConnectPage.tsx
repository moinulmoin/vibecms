'use client'

import { Button, Skeleton } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageHeader, Panel, StatusAlert } from '~/components/dashboard/DashboardLayout'
import { ConnectAgent } from '~/components/dashboard/ConnectAgent'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import { createApiKeyMutation, loadConnectPage } from '~/server/dashboard-pages-fn'
import { dashboardStatusSearch } from '~/lib/dashboard-search'
import { consumeTokenFlash, saveTokenFlash } from '~/lib/token-flash'

type ConnectPageData = { canManage: boolean; mcpUrl: string }

export function ConnectPage() {
  const navigate = useNavigate()
  const formStatus = useFormStatusFromSearch()
  const [data, setData] = useState<ConnectPageData | null>(null)
  const [flash, setFlash] = useState<{ token: string; name: string } | null>(null)
  const [createPending, setCreatePending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFlash(consumeTokenFlash())
    void loadConnectPage()
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load connect page.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleQuickCreate() {
    setCreatePending(true)
    try {
      const result = await createApiKeyMutation({
        data: { name: 'My agent', actorName: 'My agent', preset: 'draft' },
      })
      if (result.kind === 'ok') {
        saveTokenFlash({ token: result.token, name: result.name })
        setFlash({ token: result.token, name: result.name })
        await navigate({ to: '/app/connect', search: dashboardStatusSearch({ ok: 'token_created' }) })
        return
      }
      await navigate({ to: '/app/connect', search: dashboardStatusSearch({ error: result.code }) })
    } finally {
      setCreatePending(false)
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>
  if (!data) {
    return (
      <>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </>
    )
  }

  const justCreated = Boolean(flash?.token)

  return (
    <>
      <PageHeader
        kicker="Connect"
        title={justCreated ? 'Your agent is ready' : 'Connect your agent'}
        description={
          justCreated
            ? 'Copy the token and config below, then paste the starter prompt into your agent.'
            : 'Generate a scoped token and point your AI agent at the blog over MCP. It can draft right away - publishing turns on when you subscribe.'
        }
        action={
          <Button asChild>
            <Link to="/app">Open dashboard</Link>
          </Button>
        }
      />
      <div className="grid gap-4">
        <StatusAlert status={formStatus} />
        {!justCreated ? (
          data.canManage ? (
            <Panel title="1. Create an agent token" meta="Draft-only">
              <div className="grid gap-3">
                <p className="font-sans text-sm leading-6 text-muted-foreground">
                  Starts as a safe draft-only assistant. You can let it publish later from Settings.
                </p>
                <Button type="button" disabled={createPending} onClick={() => void handleQuickCreate()}>
                  {createPending ? 'Creating token…' : 'Generate agent token'}
                </Button>
                <span className="font-mono text-xs text-muted-foreground">Shown once - keep it somewhere safe.</span>
              </div>
            </Panel>
          ) : (
            <Panel title="Create an agent token">
              <p className="font-sans text-sm leading-6 text-muted-foreground">
                Only the workspace owner can create agent tokens. Ask the owner to connect an agent.
              </p>
            </Panel>
          )
        ) : null}
        <Panel title={justCreated ? 'Connect and start' : '2. Connect your agent'}>
          <ConnectAgent mcpUrl={data.mcpUrl} token={flash?.token} tokenName={flash?.name} />
        </Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 p-4">
          <p className="font-sans text-sm leading-6 text-muted-foreground">
            You can revisit this and manage tokens anytime in Settings.
          </p>
          <Button asChild variant="outline">
            <Link to="/app">{justCreated ? 'Go to dashboard' : 'Skip for now'}</Link>
          </Button>
        </div>
      </div>
    </>
  )
}