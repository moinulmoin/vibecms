'use client'

import { Button, type ButtonProps } from '@vc/ui'
import { ReloadIcon } from '@radix-ui/react-icons'
import * as React from 'react'

export type PendingSubmitButtonProps = ButtonProps & {
  pending?: boolean
  pendingText?: React.ReactNode
}

/** Submit button for SPA forms that call server functions on submit (not native navigation). */
export function PendingSubmitButton({
  children,
  pending = false,
  pendingText,
  disabled,
  ...props
}: PendingSubmitButtonProps) {
  return (
    <Button type="submit" aria-busy={pending || undefined} disabled={pending || disabled} {...props}>
      {pending ? (
        <>
          <ReloadIcon className="size-4 animate-spin" aria-hidden="true" />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  )
}