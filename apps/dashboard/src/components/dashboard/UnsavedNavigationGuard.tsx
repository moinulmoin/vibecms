import { Button } from '@vc/ui'
import { useBlocker, type ShouldBlockFn } from '@tanstack/react-router'
import { useCallback, useRef } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'

function searchWithoutFeedback(search: unknown) {
  if (!search || typeof search !== 'object') return ''
  return JSON.stringify(
    Object.entries(search as Record<string, unknown>)
      .filter(([key]) => key !== 'ok' && key !== 'error')
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function UnsavedNavigationGuard({ when }: { when: boolean | (() => boolean) }) {
  const whenRef = useRef(when)
  whenRef.current = when
  const isDirty = useCallback(() => (
    typeof whenRef.current === 'function' ? whenRef.current() : whenRef.current
  ), [])
  const shouldBlock = useCallback<ShouldBlockFn>(({ current, next }) => {
    if (!isDirty()) return false
    if (current.pathname !== next.pathname) return true
    return searchWithoutFeedback(current.search) !== searchWithoutFeedback(next.search)
  }, [isDirty])
  const blocker = useBlocker({
    shouldBlockFn: shouldBlock,
    enableBeforeUnload: isDirty,
    withResolver: true,
  })

  return (
    <Dialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.status === 'blocked') blocker.reset()
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Leave with unsaved changes?</DialogTitle>
          <DialogDescription>Your latest changes have not been saved. Leaving now will discard them.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => blocker.status === 'blocked' && blocker.reset()}>
            Stay and keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={() => blocker.status === 'blocked' && blocker.proceed()}>
            Discard and leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
