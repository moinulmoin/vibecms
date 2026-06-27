import { BRAND } from '@vc/config'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Badge } from "@vc/ui"

export function OnboardingFrame({ children, phase = 'Setup' }: { children: ReactNode; phase?: string }) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col justify-center px-4 py-10 sm:py-16">
      <header className="mb-8 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-[-0.02em] text-foreground no-underline"
          >
            <img src="/brand/icon.svg" alt="" aria-hidden="true" className="size-6 rounded-md" />
            {BRAND.name}
          </Link>
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.1em]">
            {phase}
          </Badge>
        </div>
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
            {BRAND.tagline}
          </p>
          <h1 className="text-balance font-display text-3xl font-semibold leading-[1.1] tracking-[-0.04em] text-foreground sm:text-4xl">
            Set up a calm publishing system for you and your AI agents.
          </h1>
        </div>
      </header>
      {children}
    </div>
  )
}