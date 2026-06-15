import { BRAND } from '@vc/config'
import { Badge } from '@vc/ui'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function OnboardingFrame({ children, phase = 'Setup' }: { children: ReactNode; phase?: string }) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-6 grid gap-3">
        <Link to="/" className="w-fit text-sm font-semibold tracking-[-0.02em] text-foreground no-underline">
          {BRAND.name}
        </Link>
        <Badge variant="outline" className="w-fit font-mono text-[10px] uppercase tracking-[0.08em]">
          {phase}
        </Badge>
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {BRAND.tagline}
          </p>
          <h1 className="mt-3 text-balance font-display text-3xl font-semibold tracking-[-0.05em] text-foreground">
            Set up a calm publishing system for humans and AI agents.
          </h1>
        </div>
      </div>
      {children}
    </div>
  )
}