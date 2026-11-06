import { cn } from '@potluck/ui'
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import type { GridModel } from './grid'
import { axisLabels, dayNum, fullDay, month, shiftName, shiftShort, weekday } from './grid-labels'

export interface GridFrameProps extends HTMLAttributes<HTMLDivElement> {
  model: GridModel
  label: string
  renderCell: (slot: string, row: number, col: number) => ReactNode
}

/**
 * The days-by-times scaffold shared by the painter and the heatmap: column headers, hour
 * labels, and a cell renderer. ARIA grid semantics; the caller owns interaction.
 */
export const GridFrame = forwardRef<HTMLDivElement, GridFrameProps>(function GridFrame(
  { model, label, renderCell, className, ...props },
  ref,
) {
  const axis = axisLabels(model)
  // Labels like "10:30 AM" need more room than a bare hour.
  const wideAxis = axis.some((a, r) => a.visible && model.rows[r]!.minute % 60 !== 0)
  const shifted = model.days.some((day) => day.shift !== 0)
  const columns = `${wideAxis ? '3.75rem' : '2.75rem'} repeat(${model.days.length}, minmax(2.25rem, 1fr))`
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
          <span role="columnheader" className="sticky left-0 z-10 bg-card" />
          {model.days.map((day, i) => {
            const m = month.format(day.date)
            const prev = model.days[i - 1]
            const showMonth = !prev || month.format(prev.date) !== m
            const shift = shiftName(day.shift)
            return (
              <span
                role="columnheader"
                key={day.key}
                aria-label={
                  shift ? `${fullDay.format(day.date)}, ${shift}` : fullDay.format(day.date)
                }
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
                {shifted && (
                  <span aria-hidden className="text-[0.625rem] font-bold text-mute">
                    {shiftShort(day.shift) ?? ' '}
                  </span>
                )}
              </span>
            )
          })}
        </div>
        {model.rows.map((_, r) => {
          const { time, visible } = axis[r]!
          return (
            <div role="row" key={r} className="contents">
              <span
                role="rowheader"
                className="sticky left-0 z-10 -mt-[0.45rem] bg-card pr-1.5 text-right tabular text-[0.6875rem] leading-none font-medium whitespace-nowrap text-mute"
                style={{ height: '1.5rem' }}
              >
                <span className="sr-only">{time}</span>
                {visible && <span aria-hidden>{visible}</span>}
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
                    style={{ height: '1.5rem' }}
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
