import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@vc/ui'

export function NotFound({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="max-w-md space-y-2">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-primary">404</p>
        <h1 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
          Page not found
        </h1>
        <div className="font-sans text-sm leading-6 text-muted-foreground">
          {children || <p>The page you are looking for does not exist.</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            if (typeof window !== 'undefined') window.history.back()
          }}
        >
          Go back
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Start over</Link>
        </Button>
      </div>
    </div>
  )
}
