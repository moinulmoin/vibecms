import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { Scope } from '@vc/core'
import { CopyButton, Field, FieldLabel, Input, cn } from '@vc/ui'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { Button, LoadError, formatDate, formatRelative } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, PageSkeleton, Section } from '~/components/dashboard/blocks'
import {
  AgentSetup,
  CodeBlock,
  FirstPostPrompt,
  SKILLS_INSTALL_COMMAND,
  clientFromPreference,
  type AgentClient,
} from '~/components/dashboard/ConnectAgent'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { useToast } from '~/components/Toaster'
import { resolveFormStatus } from '~/components/dashboard/useFormStatusFromSearch'
import { createApiKeyMutation, revokeApiKeyMutation } from '~/lib/api-client'
import { clearTokenFlash, consumeTokenFlash, saveTokenFlash, type TokenFlash } from '~/lib/token-flash'
import { connectQuery, queryKeys } from '~/lib/queries'
import type { ApiKeyListItem } from '~/types/dashboard'

export type KeyAccess = 'draft' | 'publish' | 'full'

export const KEY_ACCESS: Array<{ id: KeyAccess; label: string; description: string }> = [
  { id: 'publish', label: 'Write and publish', description: 'Drafts, edits, image uploads, and publishing after you approve.' },
  { id: 'draft', label: 'Write drafts', description: 'Drafts, edits, and image uploads. You publish.' },
  { id: 'full', label: 'Full access', description: 'Everything above, plus archiving posts and deleting unused images.' },
]

export function accessLabel(scopes: string[]): string {
  const set = new Set(scopes as Scope[])
  if (set.has('posts:archive') || set.has('assets:delete')) return 'Full access'
  if (set.has('posts:publish')) return 'Write and publish'
  return 'Write drafts'
}

export function lastUsedLabel(lastUsedAt: number | null) {
  return lastUsedAt ? `Last used ${formatRelative(lastUsedAt)}` : 'Never used'
}

/** The one-time key reveal. Shown right after creation, then gone for good. */
export function KeyReveal({ flash, onDone }: { flash: TokenFlash; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label="Your new key"
      className="grid gap-3 rounded-xl border border-brand-bright/40 p-5 outline-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.015em] text-foreground">
            Your key for “{flash.name}”
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Copy it now. For your security, it won’t be shown again. It’s already filled in below.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code
          aria-label="One-time key"
          className="min-w-0 flex-1 break-all rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-sm text-foreground"
        >
          {flash.token}
        </code>
        <CopyButton value={flash.token} label="Copy key" copiedLabel="Copied" className="h-10" />
      </div>
    </div>
  )
}

function KeyRow({ apiKey, onDelete }: { apiKey: ApiKeyListItem; onDelete: (id: string) => Promise<void> }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-4 last:border-b-0">
      <div className="flex min-w-0 items-start gap-3.5">
        <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
          <KeyRound className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem]">
            <span className="font-medium text-foreground">{apiKey.name}</span>
            <span className="text-sm text-muted-foreground">{accessLabel(apiKey.scopes)}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className={cn(apiKey.lastUsedAt ? 'text-foreground/80' : undefined)}>{lastUsedLabel(apiKey.lastUsedAt)}</span>
            <span aria-hidden className="px-1.5 text-muted-foreground/50">·</span>
            Created {formatDate(apiKey.createdAt)}
            <span aria-hidden className="px-1.5 text-muted-foreground/50">·</span>
            <span className="font-mono text-[0.8125rem]">{apiKey.tokenPrefix}…</span>
          </p>
        </div>
      </div>
      <SpaConfirmButton
        size="sm"
        variant="ghost"
        confirmLabel="Delete key"
        pendingLabel="Deleting…"
        helperText="Any agent using this key stops working right away."
        onConfirm={() => onDelete(apiKey.id)}
        aria-label={`Delete ${apiKey.name}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 aria-hidden data-icon="inline-start" /> Delete
      </SpaConfirmButton>
    </li>
  )
}

export function NewKeyForm({
  pending,
  onCreate,
  onCancel,
  defaultName = 'My agent',
}: {
  pending: boolean
  onCreate: (input: { name: string; preset: KeyAccess }) => void
  onCancel?: () => void
  defaultName?: string
}) {
  const [name, setName] = useState(defaultName)
  const [preset, setPreset] = useState<KeyAccess>('publish')
  return (
    <form
      className="grid gap-5 rounded-xl border border-border p-5"
      onSubmit={(event) => {
        event.preventDefault()
        onCreate({ name: name.trim() || defaultName, preset })
      }}
    >
      <Field className="max-w-sm">
        <FieldLabel htmlFor="key-name">Name</FieldLabel>
        <Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
        <p className="text-sm text-muted-foreground">Shown in Activity next to what this agent changes.</p>
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">What it can do</legend>
        <RadioGroup value={preset} onValueChange={(value) => setPreset(value as KeyAccess)} className="grid gap-2 sm:grid-cols-3">
          {KEY_ACCESS.map((option) => (
            <label
              key={option.id}
              htmlFor={`key-access-${option.id}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-bright/50"
            >
              <RadioGroupItem id={`key-access-${option.id}`} value={option.id} className="mt-1" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <PendingSubmitButton pending={pending} pendingText="Creating…">
          Create key
        </PendingSubmitButton>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}

export function ConnectPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { client?: string }
  const client = search.client
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const query = useQuery(connectQuery)
  const [flash, setFlash] = useState<TokenFlash | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [createPending, setCreatePending] = useState(false)

  useEffect(() => {
    // Reload fallback: keep the one-time key on screen until the user dismisses it.
    const restored = consumeTokenFlash()
    if (restored) {
      setFlash(restored)
      saveTokenFlash(restored)
    }
  }, [])

  const data = query.data
  const activeClient: AgentClient =
    client === 'claude_code' || client === 'codex' || client === 'cursor' || client === 'other'
      ? client
      : clientFromPreference(data?.personalization.agentPreference)

  function setClient(next: AgentClient) {
    void navigate({ to: '/dashboard/connect', search: { ok: undefined, error: undefined, client: next }, replace: true })
  }

  async function createKey(input: { name: string; preset: KeyAccess }) {
    setCreatePending(true)
    try {
      const result = await createApiKeyMutation({ name: input.name, actorName: input.name, preset: input.preset })
      if (result.kind === 'ok') {
        const next = { token: result.token, name: result.name, id: result.id }
        saveTokenFlash(next)
        setFlash(next)
        setFormOpen(false)
        await queryClient.invalidateQueries({ queryKey: queryKeys.connect })
        return
      }
      const status = resolveFormStatus({ error: result.code })
      if (status) toast(status)
    } catch {
      toast({ variant: 'error', title: 'Key not created', message: 'Check your connection and try again.' })
    } finally {
      setCreatePending(false)
    }
  }

  async function deleteKey(keyId: string) {
    try {
      const result = await revokeApiKeyMutation({ keyId })
      if (result.kind !== 'ok') {
        toast({ variant: 'error', title: 'Key not deleted', message: 'Try again in a moment.' })
        return
      }
      if (flash?.id === keyId) dismissFlash()
      queryClient.setQueryData(queryKeys.connect, (prev: typeof data) =>
        prev ? { ...prev, apiKeys: prev.apiKeys.filter((key) => key.id !== keyId) } : prev,
      )
      toast({ variant: 'success', title: 'Key deleted', message: 'Agents using it can no longer reach your blog.' })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connect })
    } catch {
      toast({ variant: 'error', title: 'Key not deleted', message: 'Check your connection and try again.' })
    }
  }

  function dismissFlash() {
    clearTokenFlash()
    setFlash(null)
  }

  const header = (
    <PageHeader
      title="Connect an agent"
      description="Give an AI agent its own key so it can write on this blog. You approve before anything goes live."
    />
  )

  if (query.isError && !data) {
    return (
      <>
        {header}
        <LoadError message="Your keys didn’t load. Check your connection and try again." onRetry={() => void query.refetch()} />
      </>
    )
  }
  if (!data) {
    return (
      <>
        {header}
        <PageSkeleton variant="list" withHeader={false} />
      </>
    )
  }

  const keys = data.apiKeys

  return (
    <>
      {header}

      {flash ? <KeyReveal flash={flash} onDone={dismissFlash} /> : null}

      <Section title="Add vibecms to your agent" description="Pick your agent and copy one thing. That’s the whole setup.">
        <AgentSetup mcpUrl={data.mcpUrl} token={flash?.token} client={activeClient} onClientChange={setClient} />
      </Section>

      <Section title="Try it" description="Paste this into your agent. It will show you the draft and ask before publishing.">
        <FirstPostPrompt />
        <details className="group text-sm">
          <summary className="w-fit cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
            Optional: install the vibecms writing skills
          </summary>
          <div className="mt-3 grid gap-2">
            <p className="text-muted-foreground">They teach your agent this blog’s format and a careful review routine.</p>
            <CodeBlock label="Terminal command" code={SKILLS_INSTALL_COMMAND} copyLabel="Copy command" />
          </div>
        </details>
      </Section>

      <Section
        title="Keys"
        description={data.canManage ? 'Each agent gets its own key. Delete one to cut that agent off instantly.' : undefined}
        action={
          data.canManage && !formOpen ? (
            <Button type="button" variant="outline" onClick={() => setFormOpen(true)}>
              <Plus aria-hidden data-icon="inline-start" /> New key
            </Button>
          ) : undefined
        }
      >
        {!data.canManage ? (
          <p className="text-sm text-muted-foreground">Only the blog owner can create and delete keys.</p>
        ) : (
          <>
            {formOpen ? (
              <NewKeyForm pending={createPending} onCreate={(input) => void createKey(input)} onCancel={() => setFormOpen(false)} />
            ) : null}
            {keys.length ? (
              <ul aria-label="Agent keys" className="grid">
                {keys.map((key) => (
                  <KeyRow key={key.id} apiKey={key} onDelete={deleteKey} />
                ))}
              </ul>
            ) : formOpen ? null : (
              <EmptyState
                compact
                icon={<KeyRound />}
                title="No keys yet."
                description="Create one to connect your first agent."
                action={
                  <Button type="button" onClick={() => setFormOpen(true)}>
                    <Plus aria-hidden data-icon="inline-start" /> New key
                  </Button>
                }
              />
            )}
          </>
        )}
      </Section>
    </>
  )
}
