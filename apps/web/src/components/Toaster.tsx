'use client'

import { useNavigate, useSearch } from '@tanstack/react-router'
import { CheckCircledIcon, Cross2Icon, CrossCircledIcon } from '@radix-ui/react-icons'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FormStatus } from '@vc/config'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'

type ToastItem = FormStatus & { id: number }
type ToastContextValue = { toast: (status: FormStatus) => void }

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// Module-scoped counter for stable keys (Date.now/Math.random not needed; this
// only has to be unique within a session's toast stream).
let toastSeq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((status: FormStatus) => {
    toastSeq += 1
    const id = toastSeq
    setToasts((current) => [...current, { ...status, id }])
  }, [])

  // Stable value so consumers don't re-render when the toast list changes
  // (this provider wraps the whole app at the root).
  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  const isError = toast.variant === 'error'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={[
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-[0_16px_40px_-16px_oklch(0_0_0/0.5)] backdrop-blur-sm',
        isError ? 'border-destructive/30 bg-destructive/10' : 'border-brand-bright/30 bg-brand-bright/10',
      ].join(' ')}
    >
      {isError ? (
        <CrossCircledIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      ) : (
        <CheckCircledIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-foreground">{toast.title}</p>
        {toast.message ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{toast.message}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Cross2Icon className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Watches the `?ok=` / `?error=` status params, surfaces them as a toast, and
 * strips them from the URL so a refresh does not re-fire. Mount once near the
 * app root so every route (dashboard + onboarding) gets feedback regardless of
 * scroll position. Replaces the per-page inline status alerts.
 */
export function StatusToaster() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { ok?: string; error?: string }
  const status = useFormStatusFromSearch()

  useEffect(() => {
    if (!status) return
    toast(status)
    void navigate({
      to: '.',
      replace: true,
      search: (prev: Record<string, unknown>) => ({ ...prev, ok: undefined, error: undefined }),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.ok, search.error])

  return null
}
