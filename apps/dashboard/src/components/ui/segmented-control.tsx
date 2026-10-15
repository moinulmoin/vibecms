import { cn } from '@vc/ui'
import { RadioGroup } from 'radix-ui'
import type { ReactNode } from 'react'

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  /** Tooltip, and the accessible name when `label` is only an icon. */
  title?: string
  /**
   * Runs every time the user activates this option (pointer, Space, or arrow
   * keys), including when it is already the chosen one. `onChange` only fires
   * when the value actually changes, so put side effects that must also run on
   * a repeat pick (like switching a preview) here, not in `onChange`. Fires
   * once per activation, before `onChange`.
   */
  onActivate?: () => void
}

/**
 * The one single-choice toggle group in the dashboard (editor modes, preview
 * width, date range, theme rows, appearance). A soft track with the chosen
 * option raised on it.
 *
 * Radix RadioGroup supplies the radio keyboard contract: one tab stop on the
 * chosen option, arrow keys move and select (wrapping), Space selects. Every
 * one of those activations reaches the item as a click, which is where
 * `onActivate` runs.
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
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      disabled={disabled}
      aria-label={label}
      className={cn('gap-0.5 rounded-lg border bg-secondary/50 p-0.5', fill ? 'flex w-full' : 'inline-flex', className)}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          aria-label={typeof option.label === 'string' ? undefined : option.title}
          onClick={() => option.onActivate?.()}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
            size === 'xs' && 'h-7 px-2.5 text-xs',
            size === 'sm' && 'h-7 px-2.5 text-sm',
            size === 'icon' && 'size-7 [&_svg]:size-3.5',
            fill && 'min-w-0 flex-1 px-2',
            'text-muted-foreground hover:text-foreground',
            'data-[state=checked]:bg-background data-[state=checked]:font-medium data-[state=checked]:text-foreground data-[state=checked]:shadow-xs dark:data-[state=checked]:bg-accent',
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
