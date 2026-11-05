import { cn } from '@potluck/ui'
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import type { GridModel } from './grid'
import { dayNum, fullDay, month, rowTime, weekday } from './grid-labels'

export interface GridFrameProps extends HTMLAttributes<HTMLDivElement> {
  model: GridModel
  label: string
  renderCell: (slot: string, row: number, col: number) => ReactNode
  /** Height of one row in rem. */
  rowHeight?: number
}

/**
 * The days-by-times scaffold shared by the painter and the heatmap: column headers, hour
 * labels, and a cell renderer. ARIA grid semantics; the caller owns interaction.
 */
export const GridFrame = forwardRef<HTMLDivElement, GridFrameProps>(function GridFrame(
  { model, label, renderCell, rowHeight = 1.5, className, ...props },
  ref,
) {
  const columns = `3.25rem repeat(${model.days.length}, minmax(2.5rem, 1fr))`
  return (
    <div className="-mx-4 scrollbar-none overflow-x-auto px-4 pb-1">
      <div
        ref={ref}
        role="grid"
        aria-label={label}
        aria-rowcount={model.rows.length + 1}
        aria-colcount={model.days.length + 1}
        className={cn('grid min-w-fit gap-x-[3px] gap-y-[3px] select-none', className)}
        style={{ gridTemplateColumns: columns }}
        {...props}
      >
        <div role="row" className="contents">
          <span role="columnheader" className="sticky left-0 z-10 bg-inherit" />
          {model.days.map((day, i) => {
            const m = month.format(day.date)
            const prev = model.days[i - 1]
            const showMonth = !prev || month.format(prev.date) !== m
            return (
              <span
                role="columnheader"
                key={day.key}
                aria-label={fullDay.format(day.date)}
                className="flex flex-col items-center pb-1.5 text-center leading-tight"
              >
                <span aria-hidden className="text-[0.6875rem] font-semibold text-mute">
                  {weekday.format(day.date)}
                </span>
                <span aria-hidden className="tabular text-base font-extrabold">
                  {dayNum.format(day.date)}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'text-[0.625rem] font-semibold text-mute',
                    !showMonth && 'invisible',
                  )}
                >
                  {m}
                </span>
              </span>
            )
          })}
        </div>
        {model.rows.map((row, r) => {
          const time = rowTime(model, r) ?? ''
          const onHour = row.minute % 60 === 0
          return (
            <div role="row" key={row.minute} className="contents">
              <span
                role="rowheader"
                className="sticky left-0 z-10 -mt-[0.45rem] bg-paper pr-1.5 text-right tabular text-[0.6875rem] leading-none font-medium text-mute"
                style={{ height: `${rowHeight}rem` }}
              >
                <span aria-hidden={!onHour} className={cn(!onHour && 'sr-only')}>
                  {time}
                </span>
              </span>
              {model.days.map((day, c) => {
                const slot = model.cells[r]![c]
                return slot ? (
                  <div key={day.key} className="contents">
                    {renderCell(slot, r, c)}
                  </div>
                ) : (
                  <span
                    key={day.key}
                    role="gridcell"
                    aria-disabled
                    className="rounded-[0.3125rem] bg-sunken/40"
                    style={{ height: `${rowHeight}rem` }}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
})
