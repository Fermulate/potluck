import { formatDateRange, t } from '@potluck/i18n'
import { Link } from '@tanstack/react-router'
import type { PlanRowData } from '@/features/timeline/plan-row-data'

/** Open polls the viewer has not answered: big, tappable, one clear action. */
export function PollCards({ plans }: { plans: PlanRowData[] }) {
  return (
    <div className="-mx-4 scrollbar-none flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
      {plans.map((plan) => (
        <Link
          key={plan.id}
          to="/plans/$eventId"
          params={{ eventId: plan.id }}
          className="group flex w-72 shrink-0 snap-start flex-col gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-ink/30"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-mute">
            {plan.groupEmoji && <span aria-hidden>{plan.groupEmoji}</span>}
            {plan.groupName}
          </span>
          <span className="flex items-start gap-2">
            {plan.emoji && (
              <span aria-hidden className="text-2xl leading-none">
                {plan.emoji}
              </span>
            )}
            <span className="flourish text-[1.625rem] leading-[1.05] text-balance">
              {plan.title}
            </span>
          </span>
          <span className="text-sm text-mute">
            {t('events.card.pollWindow', {
              range: formatDateRange(plan.windowStart, plan.windowEnd, { timeZone: 'UTC' }),
            })}
          </span>
          <span className="mt-auto inline-flex h-9 items-center justify-center self-start rounded-pill bg-tomato-strong px-4 text-sm font-bold text-on-tomato transition-transform group-active:scale-[0.97]">
            {t('events.card.addTimes')}
          </span>
        </Link>
      ))}
    </div>
  )
}
