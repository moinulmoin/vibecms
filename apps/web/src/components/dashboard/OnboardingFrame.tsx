import { BRAND } from '@vc/config'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { CheckIcon } from '@radix-ui/react-icons'

const STEPS = ['Blog setup', 'Connect agent', 'First post'] as const

export function OnboardingFrame({
  children,
  step = 1,
  title = 'Set up a calm publishing system for you and your AI agents.',
}: {
  children: ReactNode
  /** 1-based position in the onboarding journey; earlier steps render as done. */
  step?: number
  title?: string
}) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center px-4 py-10 sm:py-16">
      <header className="mb-8 flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-[-0.02em] text-foreground no-underline"
          >
            <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />
            {BRAND.name}
          </Link>
          <ol aria-label="Onboarding steps" className="flex items-center gap-3 font-mono text-[11px] sm:gap-4">
            {STEPS.map((label, index) => {
              const position = index + 1
              const state = position < step ? 'done' : position === step ? 'current' : 'todo'
              return (
                <li
                  key={label}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className="flex items-center gap-1.5"
                >
                  {state === 'done' ? (
                    <CheckIcon className="size-3.5 text-primary" aria-hidden="true" />
                  ) : (
                    <span className={state === 'current' ? 'text-primary' : 'text-muted-foreground/70'}>
                      0{position}
                    </span>
                  )}
                  <span
                    className={
                      state === 'current'
                        ? 'font-medium text-foreground'
                        : 'hidden text-muted-foreground/70 sm:inline'
                    }
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
        <h1 className="text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.04em] text-foreground sm:text-4xl">
          {title}
        </h1>
      </header>
      {children}
    </div>
  )
}
