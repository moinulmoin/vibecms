import { createFileRoute } from '@tanstack/react-router'
import { AGENT_TOKEN_PRESETS } from '@vc/core'
import { Button, Alert } from '@vc/ui'
import { useEffect, useState } from 'react'
import { EmptyState, PageHeader, PageSkeleton, Panel } from '~/components/dashboard/blocks'

type AccessLevel = 'draft' | 'publish' | 'manage'
type ConsentRequest = {
  client: { name: string; host: string; trusted: boolean; registration: 'dcr' | 'cimd' }
  redirect: { host: string; loopbackOnly: boolean }
  requestedScopes: string[]
  blogs: Array<{ siteId: string; name: string; url: string | null }>
  expiresAt: number
}

type State =
  | { kind: 'loading' }
  | { kind: 'expired' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; request: ConsentRequest }
  | { kind: 'done'; redirectTo: string }

const accessOptions: Array<{ value: AccessLevel; label: string; description: string }> = [
  { value: 'draft', label: 'Write drafts', description: "Read your blog and write drafts. It can't publish." },
  { value: 'publish', label: 'Write and publish', description: 'Also publish and schedule posts. It still asks you before publishing.' },
  { value: 'manage', label: 'Manage', description: 'Also change blog settings, theme, the signup form and old-link redirects, and archive posts.' },
]

function isLevelAvailable(level: AccessLevel, requestedScopes: string[]) {
  return AGENT_TOKEN_PRESETS[level].every((scope) => requestedScopes.includes(scope))
}

export const Route = createFileRoute('/authorize')({
  validateSearch: (search: Record<string, unknown>) => ({ request: typeof search.request === 'string' ? search.request : '' }),
  component: AuthorizePage,
})

function AuthorizePage() {
  const { request: requestId } = Route.useSearch()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [siteId, setSiteId] = useState('')
  const [level, setLevel] = useState<AccessLevel | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!requestId) {
      setState({ kind: 'not-found' })
      return
    }
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const response = await fetch(`/api/dashboard/oauth/requests/${encodeURIComponent(requestId)}`, { credentials: 'same-origin', signal: controller.signal })
        if (response.status === 401) {
          window.location.assign(`/login?${new URLSearchParams({ returnTo: window.location.pathname + window.location.search })}`)
          return
        }
        if (response.status === 410) { setState({ kind: 'expired' }); return }
        if (response.status === 404) { setState({ kind: 'not-found' }); return }
        if (!response.ok) throw new Error('Could not load this sign-in request. Try again.')
        const request = await response.json() as ConsentRequest
        setSiteId(request.blogs[0]?.siteId ?? '')
        setLevel(isLevelAvailable('publish', request.requestedScopes) ? 'publish' : isLevelAvailable('draft', request.requestedScopes) ? 'draft' : null)
        setState({ kind: 'ready', request })
      } catch (cause) {
        if (!controller.signal.aborted) setState({ kind: 'error', message: cause instanceof Error ? cause.message : 'Could not load this sign-in request. Try again.' })
      }
    })()
    return () => controller.abort()
  }, [requestId])

  useEffect(() => {
    if (state.kind !== 'done') return
    const timer = window.setTimeout(() => window.location.assign(state.redirectTo), 100)
    return () => window.clearTimeout(timer)
  }, [state])

  async function respond(action: 'approve' | 'deny') {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const response = await fetch(`/api/dashboard/oauth/requests/${encodeURIComponent(requestId)}/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'approve' ? { siteId, level } : {}),
      })
      if (response.status === 401) {
        window.location.assign(`/login?${new URLSearchParams({ returnTo: window.location.pathname + window.location.search })}`)
        return
      }
      if (response.status === 410) { setState({ kind: 'expired' }); return }
      if (response.status === 404) { setState({ kind: 'not-found' }); return }
      const body = await response.json().catch(() => ({})) as { redirectTo?: string; message?: string; error?: { message?: string } }
      if (!response.ok) throw new Error(body.error?.message ?? body.message ?? 'Could not complete this sign-in. Try again.')
      if (!body.redirectTo) throw new Error('Could not complete this sign-in. Try again.')
      if (action === 'deny') window.location.assign(body.redirectTo)
      else setState({ kind: 'done', redirectTo: body.redirectTo })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete this sign-in. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-svh bg-background px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <div className="mx-auto grid w-full max-w-xl gap-7">
        <a href="/dashboard" className="inline-flex min-h-11 w-fit items-center gap-2 font-semibold no-underline">
          <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />vibecms
        </a>
        {state.kind === 'loading' ? <PageSkeleton /> : null}
        {state.kind === 'expired' ? <EmptyState title="Sign-in link expired" description="This sign-in link expired. Start again from your app." /> : null}
        {state.kind === 'not-found' ? <EmptyState title="Sign-in request not found" description="Start again from your app." /> : null}
        {state.kind === 'error' ? <EmptyState title="Could not load sign-in request" description={state.message} action={<Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>} /> : null}
        {state.kind === 'done' ? <PageHeader title="Connected. You can close this tab." /> : null}
        {state.kind === 'ready' ? (
          <>
            <PageHeader title={`Allow ${state.request.client.name} to use vibecms?`} description={<>{state.request.client.host}{!state.request.client.trusted ? <> · This name comes from the app itself.</> : null}<br />Returns to {state.request.redirect.host}</>} />
            {state.request.redirect.loopbackOnly ? <Alert variant="warning">Returns to this computer (localhost). Only continue if you just started this from an app on this computer.</Alert> : null}
            {state.request.blogs.length === 0 ? (
              <EmptyState title="Create your blog first" description="You need a blog before you can connect this app." action={<Button asChild><a href="/dashboard">Go to dashboard</a></Button>} />
            ) : (
              <Panel title="Choose access">
                <form className="grid gap-6" onSubmit={(event) => { event.preventDefault(); void respond('approve') }}>
                  <div className="grid gap-2">
                    <label htmlFor="consent-blog" className="text-sm font-medium">Blog</label>
                    <select id="consent-blog" value={siteId} onChange={(event) => setSiteId(event.target.value)} disabled={submitting} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {state.request.blogs.map((blog) => <option key={blog.siteId} value={blog.siteId}>{blog.name}{blog.url ? ` — ${blog.url}` : ''}</option>)}
                    </select>
                  </div>
                  <fieldset className="grid gap-3" disabled={submitting}>
                    <legend className="mb-3 text-sm font-medium">Access</legend>
                    {accessOptions.map((option) => {
                      const available = isLevelAvailable(option.value, state.request.requestedScopes)
                      return (
                        <label key={option.value} className={`flex items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-selected-border has-[:checked]:bg-selected ${available ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                          <input type="radio" name="access" value={option.value} checked={level === option.value} disabled={!available} onChange={() => setLevel(option.value)} className="mt-1 size-4 shrink-0 accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
                          <span className="grid gap-1"><span className="text-sm font-medium">{option.label}</span><span className="text-sm leading-6 text-muted-foreground">{option.description}</span>{!available ? <span className="text-sm leading-6 text-muted-foreground">This app didn’t ask for this access.</span> : null}</span>
                        </label>
                      )
                    })}
                  </fieldset>
                  {error ? <Alert variant="error" role="alert">{error}</Alert> : null}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" disabled={submitting} onClick={() => void respond('deny')}>Cancel</Button>
                    <Button type="submit" disabled={submitting || !siteId || !level}>{submitting ? 'Please wait…' : 'Allow'}</Button>
                  </div>
                </form>
              </Panel>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}
