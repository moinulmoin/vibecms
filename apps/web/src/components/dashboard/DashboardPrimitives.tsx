import type { ReactNode } from 'react'

type Classable = { className?: string; children?: ReactNode }

export function DotGrid({ className, children }: Classable) {
  return (
    <div className={['pointer-events-none absolute inset-0', className].filter(Boolean).join(' ')} aria-hidden="true">
      <div
        className="absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,oklch(0_0_0)_30%,transparent_75%)]"
        style={{
          backgroundImage: 'radial-gradient(var(--dot-grid-fill) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {children}
    </div>
  )
}

export function Glow({ className, children }: Classable) {
  return (
    <div
      className={[
        'pointer-events-none absolute left-1/2 top-[-240px] h-[720px] w-[1100px] -translate-x-1/2 blur-[20px]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ background: 'radial-gradient(ellipse at center, var(--glow-primary), transparent 68%)' }}
      aria-hidden="true"
    >
      {children}
    </div>
  )
}