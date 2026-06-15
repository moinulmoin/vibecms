'use client'

import { Button, type ButtonProps } from '@vc/ui'
import * as React from 'react'

export type SpaConfirmButtonProps = ButtonProps & {
  confirmLabel: React.ReactNode
  helperText?: string
  armedTimeoutMs?: number
  onConfirm: () => void | Promise<void>
}

/** Two-step confirm for SPA actions (server fn), not native form submit. */
export function SpaConfirmButton({
  children,
  confirmLabel,
  helperText,
  armedTimeoutMs = 5000,
  onConfirm,
  variant = 'destructive',
  disabled,
  onClick,
  ...props
}: SpaConfirmButtonProps) {
  const [armed, setArmed] = React.useState(false)
  const ref = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), armedTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [armed, armedTimeoutMs])

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || disabled) return
    if (!armed) {
      setArmed(true)
      requestAnimationFrame(() => ref.current?.focus())
      return
    }
    setArmed(false)
    void onConfirm()
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button ref={ref} type="button" variant={variant} disabled={disabled} onClick={handleClick} {...props}>
        {armed ? confirmLabel : children}
      </Button>
      {armed && helperText ? (
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {helperText}
        </span>
      ) : null}
    </span>
  )
}