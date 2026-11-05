import { Card } from '@potluck/ui'
import { Appear } from './appear'
import type { DayGroup } from './days'
import { dayKey } from './days'
import { PlanRow } from './plan-row'
import type { PlanRowData } from './plan-row-data'

export interface DayTimelineProps {
  groups: DayGroup<PlanRowData>[]
  timeZone: string
  todayKey: string
  showGroup?: boolean
  /** Offset for the entrance stagger when this list follows other content. */
  startIndex?: number
}

/** Plans grouped under "Today / Tomorrow / Saturday" headers. */
export function DayTimeline({
  groups,
  timeZone,
  todayKey,
  showGroup = true,
  startIndex = 0,
}: DayTimelineProps) {
  const keyOf = (iso: string) => dayKey(iso, timeZone)
  return (
    <ol className="flex flex-col gap-5">
      {groups.map((group, i) => (
        <Appear as="li" key={group.key} index={startIndex + i} className="flex flex-col gap-2">
          <h3 className="flex items-baseline gap-2 px-1">
            <span
              className={
                group.key === todayKey
                  ? 'flourish text-2xl leading-none text-tomato-ink'
                  : 'flourish text-2xl leading-none'
              }
            >
              {group.label}
            </span>
          </h3>
          <Card padding="none" className="divide-y divide-line overflow-hidden">
            {group.items.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                timeZone={timeZone}
                todayKey={todayKey}
                dayKeyOf={keyOf}
                showGroup={showGroup}
              />
            ))}
          </Card>
        </Appear>
      ))}
    </ol>
  )
}
