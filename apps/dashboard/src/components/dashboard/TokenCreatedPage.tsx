'use client'

import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '~/components/dashboard/DashboardLayout'
import { PageHeader, Panel } from '~/components/dashboard/blocks'
import { Alert, Badge } from "@vc/ui"
import { Skeleton } from "@vc/ui"
import { ConnectAgent } from '~/components/dashboard/ConnectAgent'
import { loadSettingsPage } from '~/lib/api-client'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { consumeTokenFlash } from '~/lib/token-flash'

export function TokenCreatedPage() {
  const navigate = useNavigate()
  const [flash, setFlash] = useState<{ token: string; name: string } | null>(null)
  const [mcpUrl, setMcpUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  function loadMcpUrl() {
    setLoadError(false)
    void loadSettingsPage()
      .then((data) => setMcpUrl(data.mcpUrl))
      .catch(() => setLoadError(true))
  }

  useEffect(() => {
    const consumed = consumeTokenFlash()
    if (!consumed) {
      void navigate({ to: '/dashboard/connect', search: { ok: undefined, error: 'token_expired' }})
      return
    }
    setFlash(consumed)
    loadMcpUrl()
  }, [navigate])

  if (flash && loadError) {
    return (
      <>
        <PageHeader
          title="Token created"
          description="Your token is ready, but the agent connection details could not load."
          action={
            <Button asChild variant="outline">
              <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>Back to Connect</Link>
            </Button>
          }
        />
        <Panel title="Connect your agent" meta={<Badge variant="outline">One-time token</Badge>}>
          <Alert variant="error" title="Connection details unavailable">
            We saved your one-time token on this page, but the agent configuration failed to load.
            Retry without refreshing — the token leaves with you when you copy it, and it is not
            shown again after you leave.
          </Alert>
          <div className="mt-4">
            <Button type="button" onClick={loadMcpUrl}>Retry connection details</Button>
          </div>
        </Panel>
      </>
    )
  }

  if (!flash || !mcpUrl) {
    return (
      <>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Token created"
        description="Copy this token now - it is shown only once - then drop the config into your agent."
        action={
          <Button asChild variant="outline">
            <Link to="/dashboard/connect" search={emptyDashboardStatusSearch}>Back to Connect</Link>
          </Button>
        }
      />
      <Panel title="Connect your agent" meta={<Badge variant="outline">One-time token</Badge>}>
        <p className="mb-5 font-sans text-sm leading-6 text-muted-foreground">
          Copy the token and client snippets below. Each block includes a copy action for your agent setup.
        </p>
        <ConnectAgent mcpUrl={mcpUrl} token={flash.token} tokenName={flash.name} />
      </Panel>
    </>
  )
}