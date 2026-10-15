import * as React from "react"

/**
 * Radix Dialog returns focus to its `Trigger` on close. Controlled sheets and
 * dialogs opened from a plain button (media inspector, mobile sidebar,
 * unsaved-changes prompts) have no Trigger, so Radix focuses nothing and focus
 * falls to <body>. The mobile sidebar also makes the page `inert` while open,
 * which blurs its opener before Radix's own focus scope records it.
 *
 * The Root wrappers record the element focused when `open` turns true (layout
 * effect: after the commit, before inert focus fix-up and Radix's autofocus),
 * and the Content wrappers hand focus back to it on close.
 *
 * Radix fires close autofocus after the content unmounts, so by then a closing
 * action may already have moved focus on purpose (a route change focusing the
 * destination page). Focus is only restored when it is still in the closing
 * content or has dropped to <body>; otherwise it is left where it is, and
 * Radix's own fallback is cancelled so a still-mounted opener cannot steal it.
 */
export const FocusReturnContext = React.createContext<React.RefObject<HTMLElement | null> | null>(null)

export function useFocusReturnOpener(open: boolean | undefined) {
  const opener = React.useRef<HTMLElement | null>(null)
  React.useLayoutEffect(() => {
    if (!open) return
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
  }, [open])
  return opener
}

export function useFocusReturnOnClose(onCloseAutoFocus: ((event: Event) => void) | undefined) {
  const opener = React.useContext(FocusReturnContext)
  return React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event)
      if (event.defaultPrevented) return
      const target = opener?.current
      if (opener) opener.current = null
      if (focusMovedElsewhere(event)) {
        event.preventDefault()
        return
      }
      // A disconnected opener falls through to Radix (its Trigger, if any);
      // callers whose opener unmounts pick the next control themselves.
      if (!target?.isConnected || target.closest("[inert]")) return
      event.preventDefault()
      target.focus()
    },
    [onCloseAutoFocus, opener],
  )
}

function focusMovedElsewhere(event: Event) {
  const active = document.activeElement
  if (!active || active === document.body) return false
  const content = event.target
  return !(content instanceof Node && content.contains(active))
}
