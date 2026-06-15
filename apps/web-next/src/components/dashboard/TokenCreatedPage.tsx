'use client'

import { Button } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { PageHeader, Panel } from '~/components/dashboard/DashboardLayout'
import { ConnectAgent } from '~/components/dashboard/ConnectAgent'
import { loadSettingsPage } from '~/server/dashboard-pages-fn'
import { emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import { consumeTokenFlash } from '~/lib/token-flash'

export function TokenCreatedPage() {
  const navigate = useNavigate()
  const [flash, setFlash] = useState<{ token: string; name: string } | null>(null)
  const [mcpUrl, setMcpUrl] = useState<string | null>(null)

  useEffect(() => {
    const consumed = consumeTokenFlash()
    if (!consumed) {
      void navigate({ to: '/app/settings', search: { ok: undefined, error: 'token_expired' } })
      return
    }
    setFlash(consumed)
    void loadSettingsPage().then((data) => setMcpUrl(data.mcpUrl))
  }, [navigate])

  if (!flash || !mcpUrl) {
    return <p className="font-mono text-sm text-muted-foreground">Loading token…</p>
  }

  return (
    <>
      <PageHeader
        kicker="Settings"
        title="Token created"
        description="Copy this token now - it is shown only once - then drop the config into your agent."
        action={
          <Button asChild variant="outline">
            <Link to="/app/settings" search={emptyDashboardStatusSearch}>Back to settings</Link>
          </Button>
        }
      />
      <Panel title="Connect your agent" meta="One-time token">
        <p className="mb-4 font-mono text-xs leading-5 text-muted-foreground">
          Copy the token and client snippets below. Each block includes a copy action for your agent setup.
        </p>
        <ConnectAgent mcpUrl={mcpUrl} token={flash.token} tokenName={flash.name} />
      </Panel>
    </>
  )
}