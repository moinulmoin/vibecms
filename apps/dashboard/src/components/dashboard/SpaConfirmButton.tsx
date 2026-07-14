'use client'

import { Button, type ButtonProps } from '@vc/ui'
import * as React from 'react'

export type SpaConfirmButtonProps = ButtonProps & {
  confirmLabel: React.ReactNode
  helperText?: string
  /** Label shown while the onConfirm promise is in flight. Defaults to confirmLabel. */
  pendingLabel?: React.ReactNode
  armedTimeoutMs?: number
  onConfirm: () => void | Promise<void>
}

/** Two-step confirm for SPA actions (server fn), not native form submit. */
export function SpaConfirmButton({
  children,
  confirmLabel,
  helperText,
  pendingLabel,
  armedTimeoutMs = 5000,
  onConfirm,
  variant = 'destructive',
  disabled,
  onClick,
  ...props
}: SpaConfirmButtonProps) {
  const [armed, setArmed] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const ref = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), armedTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [armed, armedTimeoutMs])

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || disabled || submitting) return
    if (!armed) {
      setArmed(true)
      requestAnimationFrame(() => ref.current?.focus())
      return
    }
    // Confirmed: invoke once, stay locked until the promise settles, then disarm.
    // Error surfacing is the caller's responsibility (onConfirm); here we only
    // guarantee the pending/disabled lifecycle always resets.
    setSubmitting(true)
    try {
      await onConfirm()
    } catch {
      // Swallowed on purpose; see comment above.
    } finally {
      setSubmitting(false)
      setArmed(false)
    }
  }

  const label = submitting ? (pendingLabel ?? confirmLabel) : armed ? confirmLabel : children

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        ref={ref}
        type="button"
        variant={variant}
        aria-busy={submitting || undefined}
        disabled={disabled || submitting}
        onClick={handleClick}
        {...props}
      >
        {label}
      </Button>
      {armed && helperText ? (
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {helperText}
        </span>
      ) : null}
    </span>
  )
}