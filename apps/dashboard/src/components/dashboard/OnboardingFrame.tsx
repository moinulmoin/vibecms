import { BRAND } from '@vc/config'
import type { ReactNode } from 'react'

const STEP_NAMES = ['Name your blog', 'Connect your agent'] as const

function StepIndicator({ step }: { step: { current: number; total: number } }) {
  return (
    <div className="flex items-center gap-3">
      <ol className="flex items-center gap-1.5" aria-label={`Step ${step.current} of ${step.total}`}>
        {Array.from({ length: step.total }, (_, index) => {
          const n = index + 1
          return (
            <li key={n} aria-current={n === step.current ? 'step' : undefined}>
              <span
                className={[
                  'block h-1 rounded-full transition-[width,background-color] duration-300 ease-out',
                  n === step.current ? 'w-8 bg-primary' : n < step.current ? 'w-4 bg-primary/50' : 'w-4 bg-foreground/15',
                ].join(' ')}
              />
              <span className="sr-only">{STEP_NAMES[index] ?? `Step ${n}`}</span>
            </li>
          )
        })}
      </ol>
      <span className="text-sm tabular-nums text-muted-foreground" aria-hidden="true">
        {step.current}/{step.total}
      </span>
    </div>
  )
}

/**
 * Frame for the two onboarding screens: no sidebar, a calm surface, a step
 * indicator, and an optional side panel (live preview / live agent status).
 */
export function OnboardingFrame({
  children,
  step,
  title,
  description,
  aside,
}: {
  children: ReactNode
  step?: { current: number; total: number }
  title: string
  description?: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="relative isolate min-h-svh overflow-x-clip">
      <main className={`mx-auto flex min-h-svh w-full flex-col px-5 py-8 sm:px-8 sm:py-10 ${aside ? 'max-w-5xl' : 'max-w-xl'}`}>
        <div className="flex items-center justify-between gap-3">
          <a
            href={BRAND.marketingUrl}
            className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.02em] text-foreground no-underline"
          >
            <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />
            {BRAND.name}
          </a>
          {step ? <StepIndicator step={step} /> : null}
        </div>
        <div
          className={
            aside
              ? 'grid flex-1 content-start items-start gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:content-center lg:gap-14 lg:py-16'
              : 'flex flex-1 flex-col justify-center py-10'
          }
        >
          <div className="min-w-0">
            <header className="mb-8 space-y-2.5">
              <h1 className="text-balance font-display text-3xl font-semibold leading-tight tracking-[-0.03em] text-foreground">
                {title}
              </h1>
              {description ? <p className="max-w-[46ch] text-pretty text-[1.0625rem] leading-7 text-muted-foreground">{description}</p> : null}
            </header>
            {children}
          </div>
          {aside ? <aside className="min-w-0 lg:sticky lg:top-10">{aside}</aside> : null}
        </div>
      </main>
    </div>
  )
}
