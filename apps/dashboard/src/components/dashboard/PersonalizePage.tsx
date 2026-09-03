'use client'

import { Alert, FieldDescription, FieldLegend, FieldSet, Skeleton } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button, LoadError } from '~/components/dashboard/DashboardLayout'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { loadPersonalization, savePersonalizationMutation } from '~/lib/api-client'
import { dashboardStatusSearch, emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import type { AgentPreference } from '~/types/dashboard'

const AGENT_CHOICES: Array<{ id: AgentPreference; label: string; note: string }> = [
  { id: 'claude_code', label: 'Claude Code', note: 'Copy one terminal command' },
  { id: 'codex', label: 'Codex CLI', note: 'Copy one config block' },
  { id: 'cursor', label: 'Cursor', note: 'Connect from your editor' },
  { id: 'droid', label: 'Droid', note: 'Use Streamable HTTP MCP' },
  { id: 'other', label: 'Another MCP client', note: 'Use the standard endpoint and Bearer token' },
]

export function PersonalizePage() {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [agent, setAgent] = useState<AgentPreference | ''>('')

  useEffect(() => {
    let cancelled = false
    void loadPersonalization()
      .then((data) => {
        if (cancelled) return
        setAgent(data.agentPreference ?? '')
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your agent choices.')
      })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      const result = await savePersonalizationMutation({ agentPreference: agent || null })
      if (result.kind === 'ok') {
        await navigate({ to: '/dashboard/connect', search: emptyDashboardStatusSearch })
        return
      }
      setSubmitError(result.code === 'owner_required'
        ? 'Only the workspace owner can save this choice. You can still continue to Connect.'
        : 'Could not save this client choice. You can continue and choose a snippet on the next screen.')
    } catch {
      setSubmitError('Could not save this client choice. Check your connection or continue to see every setup option.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!loaded) {
    return (
      <OnboardingFrame step={2} title="Which agent are you connecting?">
        <Skeleton className="h-[22rem] rounded-xl" />
      </OnboardingFrame>
    )
  }

  return (
    <OnboardingFrame step={2} title="Which agent are you connecting?">
      <p className="-mt-4 mb-7 max-w-[52ch] font-sans text-sm leading-6 text-muted-foreground">
        Choose a client so the next screen leads with the exact command or config it needs. The MCP endpoint and capabilities are identical in every client.
      </p>
      {submitError ? <Alert variant="error" className="mb-4">{submitError}</Alert> : null}
      <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6" onSubmit={(event) => void handleSubmit(event)}>
        <FieldSet className="min-w-0 gap-3">
          <FieldLegend className="font-mono text-[11px] font-medium text-muted-foreground">
            Agent client
          </FieldLegend>
          <RadioGroup
            value={agent}
            onValueChange={(value) => setAgent(value as AgentPreference)}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2"
          >
            {AGENT_CHOICES.map((choice) => (
              <label
                key={choice.id}
                htmlFor={`agent-${choice.id}`}
                className="flex min-h-16 min-w-0 cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-border/60 transition-colors last:sm:col-span-2 hover:bg-muted/40 has-[[data-state=checked]]:bg-brand-bright/[0.045] has-[[data-state=checked]]:ring-brand-bright/50"
              >
                <RadioGroupItem id={`agent-${choice.id}`} value={choice.id} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block font-display text-sm font-medium text-foreground">{choice.label}</span>
                  <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">{choice.note}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <FieldDescription>
            No lock-in. The setup guide includes every supported client, regardless of this choice.
          </FieldDescription>
        </FieldSet>

        <div className="flex flex-col gap-4 rounded-xl bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] leading-5 text-muted-foreground">
            Voice, theme, and domains wait until after your first verified publish.
          </p>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button variant="ghost" asChild className="h-11 w-full rounded-xl sm:w-auto">
              <Link to="/dashboard/connect" search={dashboardStatusSearch({})}>Skip to setup guide</Link>
            </Button>
            <PendingSubmitButton
              className="h-11 w-full rounded-xl px-6 sm:w-auto"
              pending={submitting}
              pendingText="Saving…"
              disabled={!agent}
            >
              Continue to Connect
            </PendingSubmitButton>
          </div>
        </div>
      </form>
    </OnboardingFrame>
  )
}
