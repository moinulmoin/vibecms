import { cn } from '@vc/ui'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

/** `plain` is for explainers (how it works): numbered, nothing to do yet, nothing muted. */
export type StepState = 'done' | 'current' | 'upcoming' | 'plain'

/** Numbered marker: a brand check when done, the selected tint when it's the step to do now. */
export function StepMarker({ state, n }: { state: StepState; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
        state === 'done' && 'bg-brand-bright text-brand-bright-foreground',
        state === 'current' && 'border-2 border-selected-border text-selected-foreground',
        (state === 'upcoming' || state === 'plain') && 'border border-border text-muted-foreground',
      )}
    >
      {state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : n}
    </span>
  )
}

/**
 * A sequence joined by a line down the markers (docs-style steps). Used for
 * every "do these in order" list: onboarding, the live agent checklist, the
 * first-run guide, the sign-in explainer.
 */
export function Steps({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn('grid', className)}>{children}</ol>
}

export function Step({
  n,
  state = 'upcoming',
  title,
  detail,
  action,
  optional,
  size = 'md',
  titleAs: Title = 'p',
  titleId,
  children,
}: {
  n: number
  state?: StepState
  title: ReactNode
  detail?: ReactNode
  /** Right-aligned control (a button to do the step). */
  action?: ReactNode
  optional?: boolean
  /** `sm` for side panels, `md` for the main column. */
  size?: 'sm' | 'md'
  /** Use a heading when the step heads a section with its own content. */
  titleAs?: 'p' | 'h2' | 'h3'
  titleId?: string
  /** Content under the title (code blocks, forms). */
  children?: ReactNode
}) {
  return (
    <li
      data-state={state}
      className={cn(
        'relative grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3',
        size === 'sm' ? 'pb-5' : children ? 'pb-10' : 'pb-6',
        'last:pb-0',
        // The rail: from under this marker to the next one; brand once the step is done.
        'before:absolute before:bottom-0 before:left-[0.6875rem] before:top-7 before:w-px before:bg-border last:before:hidden data-[state=done]:before:bg-brand-bright/50',
      )}
    >
      <StepMarker state={state} n={n} />
      <div className="min-w-0 pt-0.5">
        <Title
          id={titleId}
          className={cn(
            'flex flex-wrap items-center gap-x-2',
            size === 'sm' ? 'text-sm' : 'text-base',
            state === 'upcoming' ? 'text-muted-foreground' : 'font-medium text-foreground',
            state === 'done' && size === 'md' && 'font-normal text-muted-foreground',
          )}
        >
          {title}
          {optional && state !== 'done' ? (
            <span className="rounded-md border px-1.5 text-[11px] font-normal leading-5 text-muted-foreground">Optional</span>
          ) : null}
          {state === 'done' ? <span className="sr-only"> (done)</span> : null}
        </Title>
        {detail ? (
          <p className={cn('mt-0.5 text-muted-foreground', size === 'sm' ? 'text-[13px] leading-5' : 'text-sm leading-6')}>{detail}</p>
        ) : null}
        {children ? <div className="mt-4 grid min-w-0 gap-4">{children}</div> : null}
      </div>
      {action ? <div className="self-start">{action}</div> : <span />}
    </li>
  )
}
