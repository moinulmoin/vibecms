import { Check } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cn } from '@vc/ui'
import { Button } from '~/components/dashboard/DashboardLayout'
import { PendingSubmitButton } from '~/components/dashboard/PendingSubmitButton'

const SAVE_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘S' : 'Ctrl+S'

/**
 * Save controls for a long form. Render it as the form's last child: it
 * floats at the bottom of the screen while there is something to save, so
 * Save is never below the fold, and Cmd/Ctrl+S saves from anywhere on the page.
 */
export function FloatingSaveBar({
  dirty,
  pending,
  disabled,
  onDiscard,
  onShortcut,
  hint,
  notice,
  className,
}: {
  dirty: boolean
  pending: boolean
  disabled?: boolean
  onDiscard?: () => void
  /** What Cmd/Ctrl+S runs. Defaults to submitting the surrounding form. */
  onShortcut?: () => void
  /** Shown after "Unsaved changes" on wider screens. */
  hint?: string
  /** Replaces the unsaved line, e.g. after a save or a failed one. */
  notice?: { tone: 'success' | 'error'; text: string } | null
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const saveRef = useRef<(() => void) | null>(null)
  saveRef.current = dirty && !pending && !disabled
    ? onShortcut ?? (() => ref.current?.closest('form')?.requestSubmit())
    : null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
        // Never the browser's "Save page" dialog on a form page.
        event.preventDefault()
        saveRef.current?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const active = dirty || pending
  return (
    <div
      ref={ref}
      aria-live="polite"
      className={cn('pointer-events-none sticky bottom-4 z-20 flex justify-center empty:hidden', className)}
    >
      {active || notice ? (
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-border bg-background/95 py-2 pl-4 pr-2 shadow-lg shadow-black/10 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 max-sm:px-3">
          <p className="text-sm">
            {notice?.tone === 'error' ? (
              <span role="alert" className="text-destructive">{notice.text}</span>
            ) : active ? (
              <>
                <span className="font-medium text-foreground">Unsaved changes</span>
                {hint ? <span className="hidden text-muted-foreground sm:inline"> · {hint}</span> : null}
              </>
            ) : notice ? (
              <span className="inline-flex items-center gap-1.5 py-1 pr-2 text-foreground">
                <Check aria-hidden className="size-4 text-brand-bright" /> {notice.text}
              </span>
            ) : null}
          </p>
          {active ? (
            <div className="flex items-center gap-1.5">
              {onDiscard ? (
                <Button type="button" size="sm" variant="ghost" onClick={onDiscard} disabled={pending}>
                  Discard
                </Button>
              ) : null}
              <PendingSubmitButton size="sm" pending={pending} pendingText="Saving…" disabled={disabled} title={`Save changes (${SAVE_SHORTCUT})`}>
                Save changes
              </PendingSubmitButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
