import { Link, useLocation, useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@vc/ui'

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const isRoot = useLocation({
    select: (location) => location.pathname === '/',
  })

  console.error('DefaultCatchBoundary Error:', error)

  const message = error instanceof Error && error.message ? error.message : 'An unexpected error occurred.'

  return (
    <div className="flex min-h-[60vh] min-w-0 flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
          Something went wrong
        </h1>
        <p className="font-sans text-sm leading-6 text-muted-foreground">{message}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => router.invalidate()}>
          Try again
        </Button>
        {isRoot ? (
          <Button asChild variant="outline">
            <Link to="/">Home</Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={(event) => {
              event.preventDefault()
              window.history.back()
            }}
          >
            Go back
          </Button>
        )}
      </div>
    </div>
  )
}
