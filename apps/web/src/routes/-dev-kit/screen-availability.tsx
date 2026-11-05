import { heatLevel } from '@potluck/tokens'
import {
  AvatarStack,
  Badge,
  Button,
  Card,
  HeatCell,
  IconButton,
  SegmentedControl,
  type HeatLevel,
} from '@potluck/ui'
import { ChevronLeft, Ellipsis, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { best, heatBusy, heatCounts, heatDays, heatTimes, mySlots, people } from './data'

const en = 'en-US'
const TOTAL = 7

function isIn(list: Array<[number, number]>, row: number, col: number) {
  return list.some(([r, c]) => r === row && c === col)
}

export function HeatGrid({ view }: { view: 'everyone' | 'me' }) {
  const max = Math.max(...heatCounts.flat())
  return (
    <div
      role="grid"
      aria-label="Group availability, 6 to 10:30 pm"
      className="grid grid-cols-[2.75rem_repeat(5,minmax(0,1fr))] gap-1"
    >
      <div role="row" className="contents">
        <span role="columnheader" />
        {heatDays.map((d) => (
          <span
            role="columnheader"
            key={d.toISOString()}
            className="flex flex-col items-center pb-1.5 text-center leading-tight"
          >
            <span className="text-[0.6875rem] font-semibold text-mute">
              {new Intl.DateTimeFormat(en, { weekday: 'short' }).format(d)}
            </span>
            <span className="tabular text-base font-extrabold">{d.getDate()}</span>
          </span>
        ))}
      </div>
      {heatTimes.map((t, row) => (
        <div role="row" key={t} className="contents">
          <span
            role="rowheader"
            className="-mt-2 pr-1 text-right tabular text-[0.6875rem] font-medium text-mute"
          >
            {row % 2 === 0 ? t : ''}
          </span>
          {heatDays.map((d, col) => {
            const count = heatCounts[row]![col]!
            const mine = isIn(mySlots, row, col)
            const level = view === 'me' ? (mine ? 4 : 0) : (heatLevel(count, max) as HeatLevel)
            const inBest =
              view === 'everyone' && col === best.col && row >= best.from && row <= best.to
            return (
              <HeatCell
                role="gridcell"
                key={d.toISOString()}
                level={level}
                busy={isIn(heatBusy, row, col)}
                mine={view === 'everyone' && mine ? 'yes' : undefined}
                selected={inBest}
                aria-label={`${new Intl.DateTimeFormat(en, { weekday: 'long' }).format(d)} ${t} pm, ${count} of ${TOTAL} free`}
                className={
                  inBest
                    ? row === best.from
                      ? 'rounded-b-none'
                      : row === best.to
                        ? 'rounded-t-none'
                        : 'rounded-none'
                    : undefined
                }
                style={{ height: 26 }}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function HeatLegend() {
  return (
    <div className="flex items-center gap-2 text-xs text-mute">
      <span>Nobody</span>
      <span className="flex gap-0.5" aria-hidden>
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <HeatCell key={l} level={l} className="size-3.5 min-h-0 rounded-[3px]" />
        ))}
      </span>
      <span>Everyone</span>
      <span className="ml-auto flex items-center gap-1.5">
        <HeatCell level={0} busy className="size-3.5 min-h-0 rounded-[3px]" aria-hidden />
        Busy
      </span>
    </div>
  )
}

export function BestTimeCard() {
  const free = people.slice(0, 6)
  return (
    <Card tone="saffron" padding="roomy" className="flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
          <Sparkles aria-hidden className="size-4" />
          Best time
        </span>
        <span className="tabular text-sm font-semibold">6 of 7 free</span>
      </div>
      <div>
        <p className="text-[2rem] leading-[1.05] font-extrabold tracking-tight">Sunday, Nov 15</p>
        <p className="mt-1 tabular text-lg font-semibold">7:30 to 9:30 pm</p>
      </div>
      <div className="flex items-center justify-between gap-3 [--avatar-ring:var(--color-saffron)]">
        <div className="flex items-center gap-2">
          <AvatarStack people={[...free]} max={5} size="sm" label="6 people free" />
          <span className="text-sm">Sam can’t</span>
        </div>
        <Button size="sm" variant="ink">
          Lock it in
        </Button>
      </div>
    </Card>
  )
}

export function AvailabilityScreen() {
  const [view, setView] = useState<'everyone' | 'me'>('everyone')
  return (
    <div className="flex flex-col gap-5 px-4">
      <div className="-mx-2 flex items-center justify-between">
        <IconButton label="Back" icon={<ChevronLeft />} />
        <IconButton label="More" icon={<Ellipsis />} />
      </div>
      <header className="-mt-2">
        <div className="mb-2 flex items-center gap-2">
          <span aria-hidden className="text-2xl leading-none">
            🍜
          </span>
          <Badge tone="saffron" dot>
            Picking a time
          </Badge>
        </div>
        <h1 className="flourish text-[2.75rem] leading-[0.95]">Ramen night</h1>
        <p className="mt-2 text-sm text-mute">Thursday regulars, 5 of 7 replied. Closes Friday.</p>
      </header>

      <BestTimeCard />

      <section aria-label="Availability" className="flex flex-col gap-3">
        <SegmentedControl
          label="Show"
          block
          size="sm"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'me', label: 'Just me' },
          ]}
        />
        <HeatGrid view={view} />
        <HeatLegend />
      </section>
    </div>
  )
}
