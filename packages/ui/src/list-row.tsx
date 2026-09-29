import { Slot, Slottable } from '@radix-ui/react-slot'
import { ChevronRight } from 'lucide-react'
import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from 'react'
import { cn } from './cn'

export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Right side, top line (usually an Amount). */
  meta?: ReactNode
  /** Right side, under the meta (usually a small status). */
  metaSub?: ReactNode
  /** Show a chevron to signal navigation. */
  chevron?: boolean
  /**
   * Render the single child element (an empty router Link or button) as the
   * row; the row content is placed inside it. Without it the row is a div.
   */
  asChild?: boolean
  children?: ReactNode
}

/**
 * One line in a list: leading visual, two lines of text, and a right column.
 * Put rows inside a `Card padding="none"` with `divide-y divide-line`.
 */
export const ListRow = forwardRef<HTMLElement, ListRowProps>(function ListRow(
  { leading, title, subtitle, meta, metaSub, chevron, asChild, className, children, ...props },
  ref,
) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.9375rem] font-semibold text-ink">{title}</span>
        {subtitle && <span className="truncate text-sm text-mute">{subtitle}</span>}
      </span>
      {(meta || metaSub) && (
        <span className="flex shrink-0 flex-col items-end text-right">
          {meta && <span className="text-[0.9375rem] font-bold">{meta}</span>}
          {metaSub && <span className="text-xs text-mute">{metaSub}</span>}
        </span>
      )}
      {chevron && <ChevronRight aria-hidden className="-mr-1 size-4 shrink-0 text-mute" />}
    </>
  )
  const classes = cn(
    'flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left',
    asChild &&
      'outline-offset-[-2px] transition-colors duration-150 first:rounded-t-[inherit] last:rounded-b-[inherit] hover:bg-sunken/70 active:bg-sunken',
    className,
  )
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        <Slottable>{children}</Slottable>
        {body}
      </Slot>
    )
  }
  return (
    <div ref={ref as Ref<HTMLDivElement>} className={classes} {...props}>
      {body}
    </div>
  )
})
