import { springs } from '@potluck/tokens'
import { motion } from 'motion/react'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'
import { usePrefersReducedMotion } from './hooks'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onValueChange: (value: T) => void
  /** Accessible name for the group, e.g. "Split type". */
  label: string
  size?: 'sm' | 'md'
  /** Stretch options to fill the width. */
  block?: boolean
  className?: string
}

/**
 * A radio group drawn as a pill track with a sliding thumb. Arrow keys move
 * the selection (and focus), Home and End jump to the ends.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  size = 'md',
  block,
  className,
}: SegmentedControlProps<T>) {
  const layoutId = useId()
  const reduced = usePrefersReducedMotion()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)

  const select = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onValueChange(option.value)
    refs.current[index]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const pos = enabled.indexOf(index)
    let next: number | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (next === undefined) return
    e.preventDefault()
    select(next)
  }

  const selectedIndex = options.findIndex((o) => o.value === value)
  const tabStop = selectedIndex >= 0 ? selectedIndex : (enabled[0] ?? 0)

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'relative inline-flex rounded-pill bg-sunken p-1 ring-1 ring-line ring-inset',
        block && 'flex w-full',
        className,
      )}
    >
      {options.map((option, i) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative isolate inline-flex items-center justify-center gap-1.5 rounded-pill font-semibold whitespace-nowrap transition-colors duration-150 disabled:opacity-40 [&_svg]:size-4',
              size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
              block && 'flex-1',
              checked ? 'text-ink' : 'text-mute hover:text-ink',
            )}
          >
            {checked && (
              <motion.span
                layoutId={layoutId}
                aria-hidden
                className="absolute inset-0 -z-10 rounded-pill bg-card shadow-[0_1px_2px_rgb(60_40_15/0.12),0_0_0_1px_var(--pl-line)]"
                transition={reduced ? { duration: 0 } : springs.snappy}
              />
            )}
            {option.icon && (
              <span aria-hidden className="inline-flex">
                {option.icon}
              </span>
            )}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
