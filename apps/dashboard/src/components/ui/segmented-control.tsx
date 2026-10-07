import { cn } from '@vc/ui'
import type { ReactNode } from 'react'

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  /** Tooltip, and the accessible name when `label` is only an icon. */
  title?: string
}

/**
 * The one single-choice toggle group in the dashboard (editor modes, preview
 * width, date range, theme rows, appearance). A soft track with the chosen
 * option raised on it.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  fill = false,
  size = 'sm',
  className,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  /** Accessible name for the group. */
  label: string
  disabled?: boolean
  /** Stretch across the container with equal-width options. */
  fill?: boolean
  /** `xs` for dense rails, `sm` for toolbars, `icon` for icon-only options. */
  size?: 'xs' | 'sm' | 'icon'
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('gap-0.5 rounded-lg border bg-secondary/50 p-0.5', fill ? 'flex w-full' : 'inline-flex', className)}
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={typeof option.label === 'string' ? undefined : option.title}
            title={option.title}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
              size === 'xs' && 'h-7 px-2.5 text-xs',
              size === 'sm' && 'h-7 px-2.5 text-sm',
              size === 'icon' && 'size-7 [&_svg]:size-3.5',
              fill && 'min-w-0 flex-1 px-2',
              checked
                ? 'bg-background font-medium text-foreground shadow-xs dark:bg-accent'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
