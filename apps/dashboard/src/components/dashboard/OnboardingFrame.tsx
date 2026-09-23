import { BRAND } from '@vc/config'
import type { ReactNode } from 'react'

/** Quiet frame for the two onboarding screens. No sidebar, no stepper. */
export function OnboardingFrame({
  children,
  step,
  title,
  description,
}: {
  children: ReactNode
  step?: { current: number; total: number }
  title: string
  description?: ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col px-5 py-8 sm:py-12">
      <div className="flex items-center justify-between gap-3">
        <a
          href={BRAND.marketingUrl}
          className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.02em] text-foreground no-underline"
        >
          <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />
          {BRAND.name}
        </a>
        {step ? (
          <span className="text-sm tabular-nums text-muted-foreground">
            Step {step.current} of {step.total}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col justify-center py-10">
        <header className="mb-8 space-y-2">
          <h1 className="text-balance font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground">
            {title}
          </h1>
          {description ? <p className="text-pretty text-base leading-7 text-muted-foreground">{description}</p> : null}
        </header>
        {children}
      </div>
    </main>
  )
}
