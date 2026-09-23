import { Download, Search, Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Field, FieldLabel, Input, Select, Skeleton, Textarea, cn } from '@vc/ui'
import { SubscribeBlock } from '@vc/content/public-chrome'
import type { NewsletterSettings, SubscriberRow } from '~/types/dashboard'
import { deleteSubscriberMutation, subscribersExportUrl, updateNewsletterSettingsMutation } from '~/lib/api-client'
import { Button, LoadError, formatDate } from '~/components/dashboard/DashboardLayout'
import { EmptyState, PageHeader, PageSkeleton, PageTabs, StatusBadge } from '~/components/dashboard/blocks'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { UnsavedNavigationGuard } from '~/components/dashboard/UnsavedNavigationGuard'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent } from '~/components/ui/tabs'
import { useToast } from '~/components/Toaster'
import { newsletterQuery, queryKeys, subscribersQuery } from '~/lib/queries'

type SubscribersSearch = {
  q: string | undefined
  status: string | undefined
  page: number
  tab?: 'form'
}

export const SUBSCRIBERS_PAGE_SIZE = 50

type SubscriberStatusFilter = '' | 'pending' | 'confirmed' | 'unsubscribed'

function normalizeStatus(value: string | undefined): SubscriberStatusFilter {
  return value === 'pending' || value === 'confirmed' || value === 'unsubscribed' ? value : ''
}

export function subscribersParams(search: { q?: string; status?: string; page: number }, pageSize: number) {
  return {
    search: search.q?.trim() ?? '',
    status: normalizeStatus(search.status),
    offset: (Math.max(1, search.page) - 1) * pageSize,
  }
}

function sourcePath(url: string | null) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.pathname === '/' ? parsed.hostname : parsed.pathname
  } catch {
    return url
  }
}

function SubscriberList({ search }: { search: SubscribersSearch }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const params = subscribersParams(search, SUBSCRIBERS_PAGE_SIZE)
  const query = useQuery({ ...subscribersQuery(params), placeholderData: keepPreviousData })
  const [draftQuery, setDraftQuery] = useState(params.search)
  const page = Math.max(1, search.page)

  useEffect(() => setDraftQuery(params.search), [params.search])

  function updateSearch(next: { q?: string; status?: string; page?: number }) {
    void navigate({
      to: '/dashboard/subscribers',
      search: {
        q: (next.q ?? params.search) || undefined,
        status: (next.status ?? params.status) || undefined,
        page: next.page ?? 1,
      },
      replace: true,
    })
  }

  // Live search, debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (draftQuery.trim() === params.search) return
    const timer = window.setTimeout(() => updateSearch({ q: draftQuery.trim() }), 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQuery])

  async function removeRow(row: SubscriberRow) {
    try {
      const result = await deleteSubscriberMutation(row.id)
      if (result.kind === 'error') throw new Error(result.code)
      toast({ variant: 'success', title: 'Subscriber removed', message: row.email })
      await queryClient.invalidateQueries({ queryKey: queryKeys.subscribersAll })
    } catch {
      toast({ variant: 'error', title: 'Subscriber not removed', message: 'Try again in a moment.' })
    }
  }

  const data = query.data
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / SUBSCRIBERS_PAGE_SIZE))
  const hasFilters = Boolean(params.search || params.status)

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search by email"
            className="pl-9"
            placeholder="Search by email"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by status"
          className="w-full sm:w-44"
          value={params.status}
          onChange={(event) => updateSearch({ status: event.currentTarget.value })}
        >
          <option value="">Everyone</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="unsubscribed">Unsubscribed</option>
        </Select>
        {data ? (
          <p className="text-sm tabular-nums text-muted-foreground sm:ml-auto">
            {total.toLocaleString()} {total === 1 ? 'person' : 'people'}
            {data.pendingCount > 0 && !params.status ? ` · ${data.pendingCount.toLocaleString()} pending` : ''}
          </p>
        ) : null}
      </div>

      {query.isError && !data ? (
        <LoadError message="Subscribers didn’t load." onRetry={() => void query.refetch()} />
      ) : !data ? (
        <PageSkeleton variant="list" withHeader={false} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={hasFilters ? <Search /> : <Users />}
          title={hasFilters ? 'No one matches that' : 'No subscribers yet'}
          description={
            hasFilters
              ? 'Try another email, or clear the filters.'
              : 'When readers sign up on your blog, they show up here.'
          }
          action={
            hasFilters ? (
              <Button type="button" variant="ghost" onClick={() => updateSearch({ q: '', status: '' })}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul aria-label="Subscribers" className={cn('grid transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          {data.rows.map((row) => {
            const source = sourcePath(row.sourceUrl)
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[0.9375rem] font-medium text-foreground">{row.email}</span>
                    {row.status !== 'confirmed' ? <StatusBadge status={row.status} /> : null}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Joined {formatDate(row.createdAt)}
                    {source ? <span className="truncate"> · from {source}</span> : null}
                  </p>
                </div>
                <SpaConfirmButton
                  size="sm"
                  variant="ghost"
                  confirmLabel="Remove"
                  pendingLabel="Removing…"
                  helperText="This permanently removes them."
                  onConfirm={() => removeRow(row)}
                  aria-label={`Remove ${row.email}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 aria-hidden className="size-4" />
                </SpaConfirmButton>
              </li>
            )
          })}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Subscriber pages">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => updateSearch({ page: page - 1 })}>
            Previous
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => updateSearch({ page: page + 1 })}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </div>
  )
}

function sameSettings(a: NewsletterSettings, b: NewsletterSettings) {
  return a.enabled === b.enabled && a.heading === b.heading && a.subtext === b.subtext && a.buttonLabel === b.buttonLabel
}

function SignupForm() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const query = useQuery(newsletterQuery)
  const [draft, setDraft] = useState<NewsletterSettings | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data)
  }, [query.data, draft])

  if (query.isError && !query.data) {
    return <LoadError message="The signup form settings didn’t load." onRetry={() => void query.refetch()} />
  }
  if (!query.data || !draft) {
    return (
      <div className="grid max-w-2xl gap-5" aria-busy="true" aria-label="Loading signup form">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
    )
  }

  const saved = query.data
  const dirty = !sameSettings(draft, saved)
  const update = (patch: Partial<NewsletterSettings>) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    setPending(true)
    try {
      const result = await updateNewsletterSettingsMutation(draft)
      if (result.kind !== 'ok') throw new Error(result.code)
      queryClient.setQueryData(queryKeys.newsletter, draft)
      toast({ variant: 'success', title: 'Signup form saved', message: 'Your blog shows the new version now.' })
    } catch {
      toast({ variant: 'error', title: 'Not saved', message: 'Check your connection and try again.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:items-start">
      <UnsavedNavigationGuard when={dirty} />
      <form className="grid max-w-2xl gap-5" onSubmit={(event) => void save(event)}>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <FieldLabel htmlFor="newsletter-enabled">Show the signup form</FieldLabel>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">In your blog footer and at the end of each post.</p>
          </div>
          <Switch id="newsletter-enabled" checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        </div>
        <Field>
          <FieldLabel htmlFor="newsletter-heading">Heading</FieldLabel>
          <Input
            id="newsletter-heading"
            value={draft.heading}
            onChange={(event) => update({ heading: event.currentTarget.value })}
            maxLength={80}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="newsletter-subtext">Description</FieldLabel>
          <Textarea
            id="newsletter-subtext"
            value={draft.subtext}
            onChange={(event) => update({ subtext: event.currentTarget.value })}
            maxLength={160}
            rows={3}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="newsletter-button-label">Button</FieldLabel>
          <Input
            id="newsletter-button-label"
            value={draft.buttonLabel}
            onChange={(event) => update({ buttonLabel: event.currentTarget.value })}
            maxLength={24}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <PendingSubmitButton pending={pending} pendingText="Saving…" disabled={!dirty}>
            Save changes
          </PendingSubmitButton>
          {dirty ? (
            <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
              Discard
            </Button>
          ) : null}
        </div>
      </form>
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">Preview</p>
        <div data-vc-theme="minimal" className="rounded-lg border border-border bg-[var(--vc-bg)] p-4">
          <SubscribeBlock variant="footer" settings={draft} />
        </div>
      </div>
    </div>
  )
}

export function SubscribersPage({ search, canExport }: { search: SubscribersSearch; canExport: boolean }) {
  const navigate = useNavigate()
  const tab = canExport && search.tab === 'form' ? 'form' : 'list'

  return (
    <>
      <PageHeader
        title="Subscribers"
        description="Readers who signed up on your blog. Email sending is coming soon; export any time."
        action={
          canExport ? (
            <Button asChild variant="outline">
              <a href={subscribersExportUrl()} download>
                <Download aria-hidden data-icon="inline-start" /> Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />
      {canExport ? (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            void navigate({
              to: '/dashboard/subscribers',
              search: { q: undefined, status: undefined, page: 1, ...(value === 'form' ? { tab: 'form' as const } : {}) },
            })
          }
          className="gap-6"
        >
          <PageTabs
            label="Subscriber sections"
            tabs={[
              { value: 'list', label: 'People' },
              { value: 'form', label: 'Signup form' },
            ]}
          />
          <TabsContent value="list">
            <SubscriberList search={search} />
          </TabsContent>
          <TabsContent value="form">{tab === 'form' ? <SignupForm /> : null}</TabsContent>
        </Tabs>
      ) : (
        <SubscriberList search={search} />
      )}
    </>
  )
}
