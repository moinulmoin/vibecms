'use client'

import { Alert, Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, Input, Textarea } from '@vc/ui'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LoadError } from '~/components/dashboard/DashboardLayout'
import { Button } from '~/components/dashboard/DashboardLayout'
import { OnboardingFrame } from '~/components/dashboard/OnboardingFrame'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Skeleton } from '@vc/ui'
import { loadPersonalization, savePersonalizationMutation } from '~/lib/api-client'
import { dashboardStatusSearch, emptyDashboardStatusSearch } from '~/lib/dashboard-search'
import type { AgentPreference } from '~/types/dashboard'

const AGENT_CHOICES: Array<{ id: AgentPreference; label: string; note: string }> = [
  { id: 'claude_code', label: 'Claude Code', note: 'Anthropic\'s terminal harness' },
  { id: 'codex', label: 'Codex CLI', note: 'OpenAI\'s terminal harness' },
  { id: 'cursor', label: 'Cursor', note: 'MCP from the editor' },
  { id: 'droid', label: 'Droid', note: 'Factory\'s agent' },
  { id: 'other', label: 'Another MCP client', note: 'Standard Streamable HTTP' },
]

const VOICE_SLOTS = 3

export function PersonalizePage() {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [agent, setAgent] = useState<AgentPreference | ''>('')
  const [voiceLinks, setVoiceLinks] = useState<string[]>(Array.from({ length: VOICE_SLOTS }, () => ''))
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadPersonalization()
      .then((data) => {
        if (cancelled) return
        setAgent(data.agentPreference ?? '')
        setVoiceLinks(
          Array.from({ length: VOICE_SLOTS }, (_, index) => data.voiceSeed[index] ?? ''),
        )
        setNote(data.onboardingNote ?? '')
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your personalization answers.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      const result = await savePersonalizationMutation({
        agentPreference: agent || null,
        voiceSeed: voiceLinks.map((link) => link.trim()).filter(Boolean),
        onboardingNote: note.trim() || null,
      })
      if (result.kind === 'ok') {
        await navigate({ to: '/dashboard/connect', search: emptyDashboardStatusSearch })
        return
      }
      setSubmitError(
        result.code === 'owner_required'
          ? 'Only the workspace owner can save these answers. You can skip ahead and answer later.'
          : 'Could not save your answers. You can continue and answer later from the connect page.',
      )
    } catch {
      setSubmitError('Could not save your answers. Check your connection and try again — or skip ahead.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!loaded)
    return (
      <OnboardingFrame step={2} title="Make it yours.">
        <Skeleton className="h-[26rem] rounded-xl" />
      </OnboardingFrame>
    )

  return (
    <OnboardingFrame step={2} title="Make it yours.">
      <p className="-mt-4 mb-7 max-w-[46ch] font-sans text-sm leading-6 text-muted-foreground">
        Three quick answers shape the next screen and your agent&apos;s first drafts. Every one is
        optional, and says exactly what it is used for.
      </p>
      {submitError ? (
        <Alert variant="error" className="mb-4">
          {submitError}
        </Alert>
      ) : null}
      <form className="grid gap-8" onSubmit={(e) => void handleSubmit(e)}>
        <FieldSet className="gap-3">
          <FieldLegend className="font-mono text-[11px] font-medium text-muted-foreground">
            {'// which agent will publish for you'}
          </FieldLegend>
          <RadioGroup
            value={agent}
            onValueChange={(value) => setAgent(value as AgentPreference)}
            className="grid gap-2 sm:grid-cols-2"
          >
            {AGENT_CHOICES.map((choice) => (
              <label
                key={choice.id}
                htmlFor={`agent-${choice.id}`}
                className="flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:bg-brand-bright/[0.045] has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-brand-bright/50"
              >
                <RadioGroupItem id={`agent-${choice.id}`} value={choice.id} className="mt-0.5" />
                <span>
                  <span className="flex items-center gap-1.5 font-display text-sm font-medium text-foreground">
                    {choice.label}
                  </span>
                  <span className="mt-1 block font-sans text-xs leading-5 text-muted-foreground">
                    {choice.note}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <FieldDescription className="font-mono text-[11px]">
            {'// used for: the connect page opens pre-configured for this agent'}
          </FieldDescription>
        </FieldSet>

        <FieldSet className="gap-3">
          <FieldLegend className="font-mono text-[11px] font-medium text-muted-foreground">
            {'// links to your writing'}
          </FieldLegend>
          <FieldGroup className="gap-3">
            {voiceLinks.map((link, index) => (
              <Field key={index}>
                <FieldLabel htmlFor={`voice-${index}`} className="sr-only">
                  Writing sample {index + 1}
                </FieldLabel>
                <Input
                  id={`voice-${index}`}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={2000}
                  value={link}
                  onChange={(event) =>
                    setVoiceLinks((current) =>
                      current.map((value, itemIndex) => (itemIndex === index ? event.target.value : value)),
                    )
                  }
                  placeholder={index === 0 ? 'https://your-site.com/an-essay' : 'https://…'}
                  className="h-11 rounded-xl"
                />
              </Field>
            ))}
          </FieldGroup>
          <FieldDescription className="font-mono text-[11px]">
            {'// used for: drafts that sound like you — your agent reads these before its first post'}
          </FieldDescription>
        </FieldSet>

        <FieldSet className="gap-3">
          <FieldLegend className="font-mono text-[11px] font-medium text-muted-foreground">
            {'// what made you look for vibecms'}
          </FieldLegend>
          <Field>
            <FieldLabel htmlFor="onboarding-note" className="sr-only">
              What made you look for vibecms
            </FieldLabel>
            <Textarea
              id="onboarding-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Docs by tools felt like templates. Reviewers kept rewriting agent drafts…"
              className="rounded-xl"
            />
          </Field>
          <FieldDescription className="font-mono text-[11px]">
            {'// read by the person building vibecms — not an algorithm'}
          </FieldDescription>
        </FieldSet>

        <div className="flex flex-col gap-4 rounded-xl bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] leading-5 text-muted-foreground">
            Everything here is optional and editable later.
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <Button variant="ghost" asChild className="h-11 rounded-xl">
              <Link to="/dashboard/connect" search={dashboardStatusSearch({})}>
                Skip for now
              </Link>
            </Button>
            <PendingSubmitButton className="h-11 rounded-xl px-6" pending={submitting} pendingText="Saving…">
              Continue
            </PendingSubmitButton>
          </div>
        </div>
      </form>
    </OnboardingFrame>
  )
}
