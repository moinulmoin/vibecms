'use client'

import { Download, Mail, Search, Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Field, FieldLabel, Input, Select, Skeleton, Textarea } from '@vc/ui'
import type { NewsletterSettings, SubscriberRow } from '~/types/dashboard'
import {
  deleteSubscriberMutation,
  loadNewsletterSettings,
  loadSubscribersPage,
  subscribersExportUrl,
  updateNewsletterSettingsMutation,
} from '~/lib/api-client'
import { Button, LoadError, formatDate } from '~/components/dashboard/DashboardLayout'
import { EmptyState, ListRow, PageHeader, Panel, StatusBadge } from '~/components/dashboard/blocks'
import { SpaConfirmButton } from '~/components/dashboard/SpaConfirmButton'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'
import { Switch } from '~/components/ui/switch'
import { SubscribeBlock } from '@vc/content/public-chrome'

type SubscribersSearch = {
  q: string | undefined
  status: string | undefined
  page: number
}

const PAGE_SIZE = 50

function SubscribersSkeleton() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </>
  )
}

export function SubscribersPage({ search, canExport }: { search: SubscribersSearch; canExport: boolean }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<SubscriberRow[] | null>(null)
  const [newsletterEnabled, setNewsletterEnabled] = useState(true)
  const [newsletterHeading, setNewsletterHeading] = useState('')
  const [newsletterSubtext, setNewsletterSubtext] = useState('')
  const [newsletterButtonLabel, setNewsletterButtonLabel] = useState('')
  const [newsletterPending, setNewsletterPending] = useState(false)
  const [newsletterError, setNewsletterError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowPending, setRowPending] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const query = search.q?.trim() ?? ''
  const status = search.status === 'pending' || search.status === 'confirmed' || search.status === 'unsubscribed'
    ? search.status
    : ''
  const page = Math.max(1, search.page)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = Boolean(query || status)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void loadSubscribersPage({ search: query, status, offset: (page - 1) * PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setRows(result.rows)
        setTotal(result.total)
        setPendingCount(result.pendingCount)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load subscribers.')
      })
    return () => {
      cancelled = true
    }
  }, [page, query, status])

  useEffect(() => {
    if (!canExport) return
    let cancelled = false
    void loadNewsletterSettings()
      .then((settings) => {
        if (cancelled) return
        setNewsletterEnabled(settings.enabled)
        setNewsletterHeading(settings.heading)
        setNewsletterSubtext(settings.subtext)
        setNewsletterButtonLabel(settings.buttonLabel)
      })
      .catch(() => {
        // The capture form stays usable without its customization panel.
      })
    return () => {
      cancelled = true
    }
  }, [canExport])

  async function handleNewsletterSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload: NewsletterSettings = {
      enabled: newsletterEnabled,
      heading: newsletterHeading,
      subtext: newsletterSubtext,
      buttonLabel: newsletterButtonLabel,
    }
    setNewsletterPending(true)
    setNewsletterError(null)
    try {
      const result = await updateNewsletterSettingsMutation(payload)
      if (result.kind !== 'ok') {
        setNewsletterError('Could not save newsletter settings. Try again.')
      }
    } catch {
      setNewsletterError('Could not save newsletter settings. Check your connection and try again.')
    } finally {
      setNewsletterPending(false)
    }
  }

  function updateSearch(next: { q?: string; status?: string; page?: number }) {
    void navigate({
      to: '/dashboard/subscribers',
      search: {
        q: (next.q ?? query) || undefined,
        status: (next.status ?? status) || undefined,
        page: next.page ?? 1,
      },
    })
  }

  async function removeRow(row: SubscriberRow) {
    setRowPending(row.id)
    setRowError(null)
    try {
      const result = await deleteSubscriberMutation(row.id)
      if (result.kind === 'error') {
        setRowError('Could not delete this subscriber.')
        return
      }
      const refreshed = await loadSubscribersPage({ search: query, status, offset: (page - 1) * PAGE_SIZE })
      setRows(refreshed.rows)
      setTotal(refreshed.total)
      setPendingCount(refreshed.pendingCount)
      if (refreshed.rows.length === 0 && page > 1 && refreshed.total > 0) {
        updateSearch({ page: Math.min(page - 1, Math.ceil(refreshed.total / PAGE_SIZE)) })
      }
    } catch {
      setRowError('Could not delete this subscriber.')
    } finally {
      setRowPending(null)
    }
  }

  if (loadError) return <LoadError message={loadError} />
  if (!rows) return <SubscribersSkeleton />

  return (
    <>
      <PageHeader
        title="Subscribers"
        description="Captured email signups from your public blog."
        action={canExport ? (
          <Button asChild variant="outline">
            <a href={subscribersExportUrl()} download>
              <Download aria-hidden data-icon="inline-start" /> Export CSV
            </a>
          </Button>
        ) : undefined}
      />
      <Panel
        title="Subscriber list"
        meta={
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {pendingCount.toLocaleString()} pending
          </span>
        }
      >
        <form
          className="mb-4 flex flex-wrap items-end gap-3 border-b border-[color:var(--hairline)] pb-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            updateSearch({
              q: (form.elements.namedItem('q') as HTMLInputElement | null)?.value.trim(),
              status: (form.elements.namedItem('status') as HTMLSelectElement | null)?.value,
            })
          }}
        >
          <Field className="w-full gap-2 sm:w-72">
            <FieldLabel className="sr-only" htmlFor="subscriber-search">Search subscribers</FieldLabel>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="subscriber-search" name="q" className="pl-9" placeholder="Search email address" defaultValue={query} />
            </div>
          </Field>
          <Field className="w-full gap-2 sm:w-44">
            <FieldLabel className="sr-only" htmlFor="subscriber-status">Status</FieldLabel>
            <Select
              id="subscriber-status"
              name="status"
              value={status}
              onChange={(event) => updateSearch({ q: query, status: event.currentTarget.value })}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="unsubscribed">Unsubscribed</option>
            </Select>
          </Field>
        </form>

        {rows.length ? (
          <div className="grid gap-0">
            {rows.map((row) => (
              <ListRow
                key={row.id}
                title={<span className="truncate font-sans text-sm font-medium text-foreground">{row.email}</span>}
                meta={<StatusBadge status={row.status} />}
                description={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-xs text-muted-foreground">
                    <span>Captured {formatDate(row.createdAt)}</span>
                    {row.sourceUrl ? <span className="truncate">from {row.sourceUrl}</span> : null}
                  </span>
                }
                actions={
                  <SpaConfirmButton
                    size="sm"
                    variant="ghost"
                    confirmLabel="Confirm delete"
                    helperText="This permanently removes the captured subscriber."
                    disabled={rowPending === row.id}
                    onConfirm={() => removeRow(row)}
                    aria-label={`Delete ${row.email}`}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    <span className="sr-only">Delete</span>
                  </SpaConfirmButton>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={hasFilters ? <Search /> : <Users />}
            title={hasFilters ? 'No subscribers match' : 'No subscribers yet'}
            description={
              hasFilters
                ? 'Clear the filters or try another email address.'
                : 'When readers use the capture form on your public blog, their email addresses appear here.'
            }
            action={undefined}
          />
        )}
        {rowError ? <p className="mt-3 text-sm text-destructive" role="alert">{rowError}</p> : null}
        {totalPages > 1 ? (
          <nav className="mt-4 flex items-center justify-between border-t border-[color:var(--hairline)] pt-4" aria-label="Subscriber pages">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => updateSearch({ page: page - 1 })}
            >
              Previous
            </Button>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">Page {page} of {totalPages}</span>
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
        <p className="mt-4 flex items-center gap-2 font-sans text-xs text-muted-foreground">
          <Mail aria-hidden className="size-3.5" /> Email delivery is coming — captured subscribers only.
        </p>
      </Panel>

      {canExport ? (
        <Panel title="Newsletter" meta="Public capture form">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] xl:items-start">
            <form className="grid max-w-2xl gap-5" onSubmit={(event) => void handleNewsletterSave(event)}>
              <div className="flex items-start justify-between gap-4 border-b border-[color:var(--hairline)] pb-4">
                <div>
                  <FieldLabel htmlFor="newsletter-enabled">Enable capture form</FieldLabel>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Show the form in the footer and at the end of published articles.
                  </p>
                </div>
                <Switch
                  id="newsletter-enabled"
                  checked={newsletterEnabled}
                  onCheckedChange={setNewsletterEnabled}
                  aria-label="Enable newsletter capture form"
                />
              </div>
              <Field>
                <FieldLabel htmlFor="newsletter-heading">Heading</FieldLabel>
                <Input
                  id="newsletter-heading"
                  value={newsletterHeading}
                  onChange={(event) => setNewsletterHeading(event.currentTarget.value)}
                  maxLength={80}
                  required
                  aria-describedby="newsletter-heading-count"
                />
                <p id="newsletter-heading-count" className="text-xs text-muted-foreground">{newsletterHeading.length}/80</p>
              </Field>
              <Field>
                <FieldLabel htmlFor="newsletter-subtext">Description</FieldLabel>
                <Textarea
                  id="newsletter-subtext"
                  value={newsletterSubtext}
                  onChange={(event) => setNewsletterSubtext(event.currentTarget.value)}
                  maxLength={160}
                  rows={3}
                  aria-describedby="newsletter-subtext-count"
                />
                <p id="newsletter-subtext-count" className="text-xs text-muted-foreground">{newsletterSubtext.length}/160</p>
              </Field>
              <Field>
                <FieldLabel htmlFor="newsletter-button-label">Button label</FieldLabel>
                <Input
                  id="newsletter-button-label"
                  value={newsletterButtonLabel}
                  onChange={(event) => setNewsletterButtonLabel(event.currentTarget.value)}
                  maxLength={24}
                  aria-describedby="newsletter-button-count"
                />
                <p id="newsletter-button-count" className="text-xs text-muted-foreground">{newsletterButtonLabel.length}/24</p>
              </Field>
              <PendingSubmitButton className="w-fit" pending={newsletterPending} pendingText="Saving…">
                Save newsletter settings
              </PendingSubmitButton>
              {newsletterError ? <p className="text-sm text-destructive" role="alert">{newsletterError}</p> : null}
              <p className="text-sm leading-6 text-muted-foreground">
                Email delivery is coming — captured subscribers only.
              </p>
            </form>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Live preview
              </p>
              <SubscribeBlock
                variant="footer"
                settings={{
                  enabled: newsletterEnabled,
                  heading: newsletterHeading,
                  subtext: newsletterSubtext,
                  buttonLabel: newsletterButtonLabel,
                }}
              />
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  )
}
